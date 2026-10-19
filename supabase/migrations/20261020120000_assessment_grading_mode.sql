-- Assessment.gradingMode: 'percentage' (today, and what a missing value means)
-- or 'sbg' (Standards-Based Grading, every question out of 4). Design:
-- docs/design/grading-modes-and-dok-grid.md section 1. NOT applied by the
-- author -- apply by hand before merging. The four fragments were reported
-- found exactly once each in production's live definitions on 19 Oct 2026.
--
-- CLAUDE.md, "Workspace persistence": this adds the column and teaches BOTH
-- sync_workspace and get_workspace_json about it. Only 'sbg' is stored;
-- anything else (absent, 'percentage', junk) is NULL, which get_workspace_json
-- leaves out -- so no value a save sends can fail it, and a test switched back
-- to Percentage is stored exactly as before this column existed.
--
-- Proof: supabase/checks/grading-mode-round-trip.sql, run by hand AFTER this
-- file by the reviewer; it rolls itself back.

set lock_timeout = '5s';

alter table public.assessments
  add column if not exists grading_mode text
  check (grading_mode is null or grading_mode = 'sbg');

do $patch$
declare
  def text;
  -- [function, fragment, replacement]
  edits text[][] := array[
    array['sync_workspace',
      'rubric, student_order, created_at)',
      'rubric, student_order, grading_mode, created_at)'],
    array['sync_workspace',
      'then a->''studentOrder'' else null end,',
      'then a->''studentOrder'' else null end, case when a->>''gradingMode'' = ''sbg'' then ''sbg'' end,'],
    array['sync_workspace',
      'student_order = excluded.student_order,',
      'student_order = excluded.student_order, grading_mode = excluded.grading_mode,'],
    array['get_workspace_json',
      '''studentOrder'', a.student_order,',
      '''studentOrder'', a.student_order, ''gradingMode'', a.grading_mode,']
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
        raise exception 'grading_mode migration: % fragment found % times, expected 1: %', fn, hits, edits[i][2];
      end if;
      def := replace(def, edits[i][2], edits[i][3]);
    end loop;
    execute def;
  end loop;
end
$patch$;
