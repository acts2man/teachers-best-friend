-- Classroom.gradingMode (Ricky, 27 Oct 2026): a class has a grading mode,
-- chosen when it is created, and every new test in it takes it (lib/grading-
-- mode.ts). Existing tests keep their own assessments.grading_mode; nothing
-- here touches them. NOT applied by the author -- apply by hand before merging.
--
-- CLAUDE.md, "Workspace persistence": this adds the column and teaches BOTH
-- sync_workspace and get_workspace_json about it. 'percentage' and 'sbg' are
-- stored; anything else (absent, junk) is NULL, which get_workspace_json
-- leaves out and the app reads by the backfill's rule below -- so no value a
-- save sends can fail it.
--
-- Backfill: every existing class is 'percentage' unless it has tests and
-- every one of them is Standards-Based. A class's tests are the ones made in
-- it (class_id) and the ones shared into it (class_ids); archived ones do not
-- count. The same rule as classGradingMode, so a class reads the same before
-- and after this is applied.
--
-- Proof: supabase/checks/class-grading-mode-round-trip.sql, run by hand
-- AFTER this file by the reviewer; it rolls itself back.

set lock_timeout = '5s';

alter table public.classes
  add column if not exists grading_mode text
  check (grading_mode is null or grading_mode in ('percentage', 'sbg'));

do $patch$
declare
  def text;
  -- [function, fragment, replacement]
  edits text[][] := array[
    array['sync_workspace',
      'insert into public.classes (teacher_id, legacy_id, name, grade, framework, color, is_demo)',
      'insert into public.classes (teacher_id, legacy_id, name, grade, framework, color, is_demo, grading_mode)'],
    array['sync_workspace',
      'c->>''color'', public.safe_bool(c->>''demo'')',
      'c->>''color'', public.safe_bool(c->>''demo''), case when c->>''gradingMode'' in (''percentage'', ''sbg'') then c->>''gradingMode'' end'],
    array['sync_workspace',
      'is_demo = excluded.is_demo,',
      'is_demo = excluded.is_demo, grading_mode = excluded.grading_mode,'],
    array['get_workspace_json',
      '''demo'', is_demo))',
      '''demo'', is_demo, ''gradingMode'', grading_mode))']
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
        raise exception 'class grading_mode migration: % fragment found % times, expected 1: %', fn, hits, edits[i][2];
      end if;
      def := replace(def, edits[i][2], edits[i][3]);
    end loop;
    execute def;
  end loop;
end
$patch$;

update public.classes c set grading_mode =
  case when exists (
         select 1 from public.assessments a
         where a.teacher_id = c.teacher_id and a.archived_at is null
           and (a.class_id = c.id or c.legacy_id = any(a.class_ids)))
       and not exists (
         select 1 from public.assessments a
         where a.teacher_id = c.teacher_id and a.archived_at is null
           and (a.class_id = c.id or c.legacy_id = any(a.class_ids))
           and a.grading_mode is distinct from 'sbg')
    then 'sbg' else 'percentage' end
where c.grading_mode is null;
