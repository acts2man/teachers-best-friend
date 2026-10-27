-- Not a migration. Run by hand AFTER
-- supabase/migrations/20261027130000_class_grading_mode.sql has been applied
-- -- by the reviewer, not by the PR's author. Pending until then.
-- Safe on production: no DDL, and every write is inside a DO block that raises
-- at the end, so the transaction rolls back and nothing it saved survives. The
-- final ERROR line IS the result -- read it, it is not a failure.
--
-- What it proves (CLAUDE.md, "Workspace persistence"):
--   - Classroom.gradingMode survives sync_workspace + get_workspace_json:
--     "sbg" and "percentage" come back as sent; junk is stored as absent
--     instead of failing the save;
--   - the save changes no test's own mode (assessments.grading_mode) and no
--     row count;
--   - the backfill left no class out (unset = 0) and every class matches its
--     rule (backfill_mismatch = 0): Standards-Based only when it has tests
--     and all are Standards-Based.
--
-- Set the teacher below to an account with at least three classes -- ideally
-- your own test account, not a pilot teacher's. lock_timeout stops it waiting
-- on anyone else.

set lock_timeout = '5s';
set statement_timeout = '30s';

do $check$
declare
  tid uuid := '00000000-0000-0000-0000-000000000000'; -- <-- set this
  ws jsonb;
  back jsonb;
  unset int;
  mismatch int;
  modes_before jsonb;
  modes_after jsonb;
  before_counts jsonb;
  after_counts jsonb;
  counts text := $q$
    select jsonb_build_object(
      'classes', (select count(*) from public.classes where teacher_id = $1 and archived_at is null),
      'assessments', (select count(*) from public.assessments where teacher_id = $1 and archived_at is null),
      'responses', (select count(*) from public.student_responses where teacher_id = $1))
  $q$;
  test_modes text := $q$
    select coalesce(jsonb_agg(jsonb_build_array(legacy_id, grading_mode) order by legacy_id), '[]')
    from public.assessments where teacher_id = $1
  $q$;
begin
  -- The backfill, everyone's classes (read only).
  execute $q$ select count(*) from public.classes where grading_mode is null $q$ into unset;
  execute $q$
    select count(*) from public.classes c
    where c.grading_mode is distinct from (
      case when exists (
             select 1 from public.assessments a
             where a.teacher_id = c.teacher_id and a.archived_at is null
               and (a.class_id = c.id or c.legacy_id = any(a.class_ids)))
           and not exists (
             select 1 from public.assessments a
             where a.teacher_id = c.teacher_id and a.archived_at is null
               and (a.class_id = c.id or c.legacy_id = any(a.class_ids))
               and a.grading_mode is distinct from 'sbg')
        then 'sbg' else 'percentage' end)
  $q$ into mismatch;

  ws := public.get_workspace_json(tid);
  if jsonb_array_length(coalesce(ws->'classes', '[]')) < 3 then
    raise exception 'NEEDS_3_CLASSES for %', tid;
  end if;
  ws := jsonb_set(ws, '{classes,0,gradingMode}', '"sbg"');
  ws := jsonb_set(ws, '{classes,1,gradingMode}', '"percentage"');
  ws := jsonb_set(ws, '{classes,2,gradingMode}', '"abc"');

  execute counts into before_counts using tid;
  execute test_modes into modes_before using tid;
  perform public.sync_workspace(tid, ws);
  back := public.get_workspace_json(tid);
  execute counts into after_counts using tid;
  execute test_modes into modes_after using tid;

  raise exception 'ROLLED_BACK expect unset=0 backfill_mismatch=0 c0=sbg c1=percentage c2=absent test_modes_unchanged=true and equal counts | got unset=% backfill_mismatch=% c0=% c1=% c2=% test_modes_unchanged=% | counts before=% after=%',
    unset, mismatch,
    coalesce(back->'classes'->0->>'gradingMode', 'absent'),
    coalesce(back->'classes'->1->>'gradingMode', 'absent'),
    coalesce(back->'classes'->2->>'gradingMode', 'absent'),
    (modes_before = modes_after), before_counts, after_counts;
end
$check$;
