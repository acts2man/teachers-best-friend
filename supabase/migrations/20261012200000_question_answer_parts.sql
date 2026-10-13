-- Question.answerParts: how many separate answers a question asks for (PR 2,
-- item 3; Ricky's idea, 12 Oct 2026). The worksheet read sets it; grading is
-- told the number, and an answer read with fewer parts is re-asked once and then
-- sent to Unsure. NOT applied by the author -- apply by hand before merging PR 2.
--
-- CLAUDE.md, "Workspace persistence": a field on a workspace type is dropped on
-- save unless BOTH sync_workspace and get_workspace_json name it. This adds the
-- column and teaches both functions about it.
--
-- How: rather than restating two functions of 19,000 and 8,000 characters (and
-- risking a stale copy reverting someone else's change), this reads the LIVE
-- definition with pg_get_functiondef, replaces exactly these fragments, and
-- refuses to continue if any fragment is not found exactly once. Run against a
-- database whose functions have moved on, it stops with an error naming the
-- fragment instead of guessing.
--
-- A bad answerParts in a saved workspace (0, 25, "abc") is CLAMPED here, not
-- rejected: under 2 is stored as NULL (one answer), over 20 as 20. The check
-- constraint stays as the last guard, but no value the save writes can trip it,
-- so one odd question can never fail a teacher's whole workspace save.
--
-- Proof: supabase/tests/20261012200000_answer_parts_round_trip.sql, run by
-- hand AFTER this file, in a transaction that rolls back.

set lock_timeout = '5s';

alter table public.assessment_questions
  add column if not exists answer_parts integer
  check (answer_parts is null or answer_parts between 1 and 20);

do $patch$
declare
  def text;
  -- [function, fragment, replacement]
  edits text[][] := array[
    array['sync_workspace',
      'reasoning, verified, excluded, key_check, points)',
      'reasoning, verified, excluded, key_check, points, answer_parts)'],
    array['sync_workspace',
      'public.safe_numeric(q->>''points'')',
      'public.safe_numeric(q->>''points''), nullif(least(greatest(coalesce(public.safe_int(q->>''answerParts''), 1), 1), 20), 1)'],
    array['sync_workspace',
      'key_check = excluded.key_check, points = excluded.points,',
      'key_check = excluded.key_check, points = excluded.points, answer_parts = excluded.answer_parts,'],
    array['get_workspace_json',
      '''keyCheck'', q.key_check, ''points'', q.points)',
      '''keyCheck'', q.key_check, ''points'', q.points, ''answerParts'', q.answer_parts)']
  ];
  fn text;
  i int;
  hits int;
begin
  foreach fn in array array['sync_workspace', 'get_workspace_json'] loop
    def := pg_get_functiondef(case fn
      when 'sync_workspace' then 'public.sync_workspace(uuid,jsonb)'::regprocedure
      else 'public.get_workspace_json(uuid)'::regprocedure end);
    for i in 1 .. array_length(edits, 1) loop
      continue when edits[i][1] <> fn;
      if position(edits[i][3] in def) > 0 then
        continue; -- already applied
      end if;
      hits := (length(def) - length(replace(def, edits[i][2], ''))) / length(edits[i][2]);
      if hits <> 1 then
        raise exception 'answer_parts migration: % fragment found % times, expected 1: %', fn, hits, edits[i][2];
      end if;
      def := replace(def, edits[i][2], edits[i][3]);
    end loop;
    execute def;
  end loop;
end
$patch$;
