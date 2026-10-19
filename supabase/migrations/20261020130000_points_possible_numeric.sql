-- Assessment.pointsPossible keeps its decimals. The column was `integer`
-- (20260930220000) and sync_workspace wrote it with public.safe_int, which
-- returns NULL for '2.5' -- so a whole-test total that is not a whole number
-- was silently dropped on save and gone on reload. The app makes one whenever
-- a question is worth a fraction of a point: setQuestionPoints
-- (lib/teacher-workflow.ts) rounds each question to 0.01 and sets
-- pointsPossible to their sum, e.g. 2.5. NOT applied by the author -- apply by
-- hand before merging.
--
-- CLAUDE.md, "Workspace persistence": the write is in sync_workspace; the read
-- in get_workspace_json ('pointsPossible', a.points_possible) needs no change,
-- since a numeric reads back as a JSON number (20 stays 20, 2.5 is 2.5).
--
-- The new write keeps a total only when it is above 0 and at most 1,000,000,
-- rounded to 0.01 with no trailing zeros (20 stays 20). That also keeps out
-- 'NaN' and 'Infinity', which safe_numeric accepts and jsonb cannot hold --
-- one such value would otherwise fail get_workspace_json for that teacher on
-- every load. 0 and below already
-- meant "no total" to the app (questionPoints uses pointsPossible only when it
-- is above 0), so storing them as NULL changes nothing it shows.
--
-- How (same as 20261013130000): read the LIVE definition with
-- pg_get_functiondef, replace exactly this fragment, and stop with an error
-- if it is not found exactly once. It touches only the assessments
-- points_possible value, so it applies before or after 20261020120000
-- (grading_mode, #168), which patches other lines of the same insert.
--
-- Proof: supabase/checks/points-possible-round-trip.sql, run by hand AFTER this
-- file by the reviewer; it rolls itself back.

set lock_timeout = '5s';

-- integer -> numeric keeps every stored value exactly.
alter table public.assessments
  alter column points_possible type numeric using points_possible::numeric;

do $patch$
declare
  def text;
  -- [function, fragment, replacement]
  edits text[][] := array[
    array['sync_workspace',
      'public.safe_int(a->>''pointsPossible'')',
      'case when public.safe_numeric(a->>''pointsPossible'') > 0 and public.safe_numeric(a->>''pointsPossible'') <= 1000000 then trim_scale(round(public.safe_numeric(a->>''pointsPossible''), 2)) end']
  ];
  fn text;
  i int;
  hits int;
begin
  foreach fn in array array['sync_workspace'] loop
    def := pg_get_functiondef('public.sync_workspace(uuid,jsonb)'::regprocedure);
    for i in 1 .. array_length(edits, 1) loop
      continue when edits[i][1] <> fn;
      if position(edits[i][3] in def) > 0 then
        continue; -- already applied
      end if;
      hits := (length(def) - length(replace(def, edits[i][2], ''))) / length(edits[i][2]);
      if hits <> 1 then
        raise exception 'points_possible migration: % fragment found % times, expected 1: %', fn, hits, edits[i][2];
      end if;
      def := replace(def, edits[i][2], edits[i][3]);
    end loop;
    execute def;
  end loop;
end
$patch$;
