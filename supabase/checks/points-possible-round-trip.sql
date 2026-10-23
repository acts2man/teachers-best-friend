-- Not a migration. Run by hand AFTER
-- supabase/migrations/20261020130000_points_possible_numeric.sql has been
-- applied -- by the reviewer, not by the PR's author. Pending until then.
-- Safe on production: no DDL, and every write is inside a DO block that raises
-- at the end, so the transaction rolls back and nothing it saved survives. The
-- final ERROR line IS the result -- read it, it is not a failure.
--
-- What it proves (CLAUDE.md, "Workspace persistence"): Assessment.pointsPossible
-- survives a save and a reload with its decimals (2.5 comes back 2.5, 20 comes
-- back 20); a value that is not a usable total ("abc", 0, "NaN") is stored as
-- absent instead of failing the save -- and, for "NaN", instead of making
-- get_workspace_json fail on every later load.
--
-- Set the teacher below to an account whose workspace has at least four
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
  before_counts jsonb;
  after_counts jsonb;
  counts text := $q$
    select jsonb_build_object(
      'assessments', (select count(*) from public.assessments where teacher_id = $1 and archived_at is null),
      'questions', (select count(*) from public.assessment_questions where teacher_id = $1),
      'responses', (select count(*) from public.student_responses where teacher_id = $1))
  $q$;
begin
  ws := public.get_workspace_json(tid);
  if jsonb_array_length(coalesce(ws->'assessments', '[]')) < 4 then
    raise exception 'NEEDS_4_ASSESSMENTS for %', tid;
  end if;

  ws := jsonb_set(ws, '{assessments,0,pointsPossible}', '2.5');
  ws := jsonb_set(ws, '{assessments,1,pointsPossible}', '20');
  ws := jsonb_set(ws, '{assessments,2,pointsPossible}', '"abc"');
  ws := jsonb_set(ws, '{assessments,3,pointsPossible}', '"NaN"');

  execute counts into before_counts using tid;
  perform public.sync_workspace(tid, ws);
  back := public.get_workspace_json(tid);
  execute counts into after_counts using tid;

  raise exception 'ROLLED_BACK expect a0=2.5 a1=20 a2=absent a3=absent and equal counts | got a0=% a1=% a2=% a3=% | counts before=% after=%',
    coalesce(back->'assessments'->0->>'pointsPossible', 'absent'),
    coalesce(back->'assessments'->1->>'pointsPossible', 'absent'),
    coalesce(back->'assessments'->2->>'pointsPossible', 'absent'),
    coalesce(back->'assessments'->3->>'pointsPossible', 'absent'),
    before_counts, after_counts;
end
$check$;
