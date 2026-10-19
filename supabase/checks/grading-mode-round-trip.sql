-- Not a migration. Run by hand AFTER
-- supabase/migrations/20261020120000_assessment_grading_mode.sql has been
-- applied -- by the reviewer, not by the PR's author. Pending until then.
-- Safe on production: no DDL, and every write is inside a DO block that raises
-- at the end, so the transaction rolls back and nothing it saved survives. The
-- final ERROR line IS the result -- read it, it is not a failure.
--
-- What it proves (CLAUDE.md, "Workspace persistence"): Assessment.gradingMode
-- survives a save and a reload through sync_workspace / get_workspace_json;
-- a value other than "sbg" (here "percentage" and junk) is stored as absent
-- instead of failing the whole save; and switching the test back to
-- Percentage (the next save without the field) clears it. Every grade and
-- every question's points come back unchanged (docs/design/
-- grading-modes-and-dok-grid.md 1.3: switching changes no stored grade).
--
-- Set the teacher below to an account whose workspace has at least three
-- assessments -- ideally your own test account, not a pilot teacher's. The
-- block holds that teacher's rows for the moment it runs (well under a second
-- for a normal workspace); lock_timeout stops it waiting on anyone else.

set lock_timeout = '5s';
set statement_timeout = '30s';

do $check$
declare
  tid uuid := '00000000-0000-0000-0000-000000000000'; -- <-- set this
  ws jsonb;
  back jsonb;
  cleared jsonb;
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
    select jsonb_build_object(
      -- Every grade and every question's points, as sorted lists: a save can
      -- re-key rows, never change a value.
      'match', (select coalesce(jsonb_agg(match_score order by match_score), '[]') from public.student_responses where teacher_id = $1),
      'points', (select coalesce(jsonb_agg(points order by points), '[]') from public.assessment_questions where teacher_id = $1))
  $q$;
begin
  ws := public.get_workspace_json(tid);
  if jsonb_array_length(coalesce(ws->'assessments', '[]')) < 3 then
    raise exception 'NEEDS_3_ASSESSMENTS for %', tid;
  end if;

  -- a0: sbg. a1: "percentage" (stored as absent). a2: junk (absent).
  ws := jsonb_set(ws, '{assessments,0,gradingMode}', '"sbg"');
  ws := jsonb_set(ws, '{assessments,1,gradingMode}', '"percentage"');
  ws := jsonb_set(ws, '{assessments,2,gradingMode}', '"abc"');

  execute counts into before_counts using tid;
  execute grades into grades_before using tid;
  perform public.sync_workspace(tid, ws);
  back := public.get_workspace_json(tid);
  -- The teacher switches a0 back to Percentage: the next save no longer
  -- carries the field.
  perform public.sync_workspace(tid, jsonb_set(back, '{assessments,0}',
    (back->'assessments'->0) - 'gradingMode'));
  cleared := public.get_workspace_json(tid);
  execute counts into after_counts using tid;
  execute grades into grades_after using tid;

  raise exception 'ROLLED_BACK expect a0=sbg a1=absent a2=absent a0_after_switch_back=absent grades_unchanged=true and equal counts | got a0=% a1=% a2=% a0_after_switch_back=% grades_unchanged=% | counts before=% after=%',
    coalesce(back->'assessments'->0->>'gradingMode', 'absent'),
    coalesce(back->'assessments'->1->>'gradingMode', 'absent'),
    coalesce(back->'assessments'->2->>'gradingMode', 'absent'),
    coalesce(cleared->'assessments'->0->>'gradingMode', 'absent'),
    grades_before = grades_after,
    before_counts, after_counts;
end
$check$;
