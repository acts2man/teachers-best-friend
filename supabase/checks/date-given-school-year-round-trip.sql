-- Not a migration. Run by hand AFTER
-- supabase/migrations/20261027140000_assessment_date_given.sql has been
-- applied -- by the reviewer, not by the PR's author. Pending until then.
-- Safe on production: no DDL, and every write is inside a DO block that raises
-- at the end, so the transaction rolls back and nothing it saved survives. The
-- final ERROR line IS the result -- read it, it is not a failure.
--
-- What it proves (CLAUDE.md, "Workspace persistence"):
--   - Assessment.dateGiven survives sync_workspace + get_workspace_json as
--     the same day ("2026-10-21"); a day that does not exist ("2026-02-31")
--     and one in another form ("10/21/2026") are stored as absent instead of
--     failing the save;
--   - Workspace.settings.schoolYear (2025) survives the same save and reload;
--   - no grade, no test and no row count changes (nothing past is deleted).
--
-- Set the teacher below to an account whose workspace has at least three
-- assessments -- ideally your own test account, not a pilot teacher's.

set lock_timeout = '5s';
set statement_timeout = '30s';

do $check$
declare
  tid uuid := '00000000-0000-0000-0000-000000000000'; -- <-- set this
  ws jsonb;
  back jsonb;
  grades_before jsonb;
  grades_after jsonb;
  before_counts jsonb;
  after_counts jsonb;
  counts text := $q$
    select jsonb_build_object(
      'assessments', (select count(*) from public.assessments where teacher_id = $1 and archived_at is null),
      'questions', (select count(*) from public.assessment_questions where teacher_id = $1),
      'responses', (select count(*) from public.student_responses where teacher_id = $1))
  $q$;
  grades text := $q$
    select coalesce(jsonb_agg(match_score order by match_score), '[]')
    from public.student_responses where teacher_id = $1
  $q$;
begin
  ws := public.get_workspace_json(tid);
  if jsonb_array_length(coalesce(ws->'assessments', '[]')) < 3 then
    raise exception 'NEEDS_3_ASSESSMENTS for %', tid;
  end if;
  ws := jsonb_set(ws, '{assessments,0,dateGiven}', '"2026-10-21"');
  ws := jsonb_set(ws, '{assessments,1,dateGiven}', '"2026-02-31"');
  ws := jsonb_set(ws, '{assessments,2,dateGiven}', '"10/21/2026"');
  ws := jsonb_set(ws, '{settings,schoolYear}', '2025');

  execute counts into before_counts using tid;
  execute grades into grades_before using tid;
  perform public.sync_workspace(tid, ws);
  back := public.get_workspace_json(tid);
  execute counts into after_counts using tid;
  execute grades into grades_after using tid;

  raise exception 'ROLLED_BACK expect a0=2026-10-21 a1=absent a2=absent schoolYear=2025 grades_unchanged=true and equal counts | got a0=% a1=% a2=% schoolYear=% grades_unchanged=% | counts before=% after=%',
    coalesce(back->'assessments'->0->>'dateGiven', 'absent'),
    coalesce(back->'assessments'->1->>'dateGiven', 'absent'),
    coalesce(back->'assessments'->2->>'dateGiven', 'absent'),
    coalesce(back->'settings'->>'schoolYear', 'absent'),
    (grades_before = grades_after), before_counts, after_counts;
end
$check$;
