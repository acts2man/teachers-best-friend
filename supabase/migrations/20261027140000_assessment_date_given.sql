-- Assessment.dateGiven (27 Oct 2026; lib/school-year.ts): the day a test was
-- given, "YYYY-MM-DD", set to the day its class set is graded and editable on
-- the test. The class super grid splits the school year by it. (The school
-- year itself is Workspace.settings.schoolYear, which sync_workspace already
-- keeps whole in teacher_workspaces.data -> 'settings': no column needed;
-- the check below proves it round-trips too.) NOT applied by the author --
-- apply by hand before merging.
--
-- CLAUDE.md, "Workspace persistence": this adds the column and teaches BOTH
-- sync_workspace and get_workspace_json about it. Only a real calendar day in
-- the form YYYY-MM-DD is stored (safe_date, from 20260909203350); anything
-- else is NULL, which get_workspace_json leaves out -- so no value a save
-- sends can fail it. Nothing existing is changed: a test from before has no
-- date given, and the app reads the day it was created instead.
--
-- The four fragments were found exactly once each in production's live
-- definitions on 27 Oct 2026 (read-only pg_get_functiondef count). The third
-- names student_order too, so it cannot match the classes upsert's
-- "grading_mode = excluded.grading_mode," from 20261027130000.
--
-- Proof: supabase/checks/date-given-school-year-round-trip.sql, run by hand
-- AFTER this file by the reviewer; it rolls itself back.

set lock_timeout = '5s';

alter table public.assessments
  add column if not exists date_given date;

do $patch$
declare
  def text;
  -- [function, fragment, replacement]
  edits text[][] := array[
    array['sync_workspace',
      'rubric, student_order, grading_mode, created_at)',
      'rubric, student_order, grading_mode, date_given, created_at)'],
    array['sync_workspace',
      'then ''sbg'' end,',
      'then ''sbg'' end, case when a->>''dateGiven'' ~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2}$'' then public.safe_date(a->>''dateGiven'') end,'],
    array['sync_workspace',
      'student_order = excluded.student_order, grading_mode = excluded.grading_mode,',
      'student_order = excluded.student_order, grading_mode = excluded.grading_mode, date_given = excluded.date_given,'],
    array['get_workspace_json',
      '''gradingMode'', a.grading_mode,',
      '''gradingMode'', a.grading_mode, ''dateGiven'', to_char(a.date_given, ''YYYY-MM-DD''),']
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
        raise exception 'date_given migration: % fragment found % times, expected 1: %', fn, hits, edits[i][2];
      end if;
      def := replace(def, edits[i][2], edits[i][3]);
    end loop;
    execute def;
  end loop;
end
$patch$;
