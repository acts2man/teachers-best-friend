-- Not a migration. Run by hand AFTER
-- supabase/migrations/20261013130000_question_second_choice.sql has been applied.
-- Safe on production: no DDL, and every write is inside a DO block that raises
-- at the end, so the transaction rolls back and nothing it saved survives. The
-- final ERROR line IS the result -- read it, it is not a failure.
--
-- What it proves (CLAUDE.md, "Workspace persistence"): Question.secondChoice
-- survives a save and a reload through sync_workspace / get_workspace_json,
-- and a value other than true is dropped instead of failing the whole save.
--
-- Set the teacher below to an account whose workspace has an assessment with
-- at least 3 questions -- ideally your own test account, not a pilot teacher's.
-- The block holds that teacher's rows for the moment it runs (well under a
-- second for a normal workspace); lock_timeout stops it waiting on anyone else.

set lock_timeout = '5s';
set statement_timeout = '30s';

do $check$
declare
  tid uuid := '00000000-0000-0000-0000-000000000000'; -- <-- set this
  ws jsonb;
  back jsonb;
  ai int;
  before_counts jsonb;
  after_counts jsonb;
  counts text := $q$
    select jsonb_build_object(
      'questions', (select count(*) from public.assessment_questions where teacher_id = $1),
      'students',  (select count(*) from public.students where teacher_id = $1),
      'responses', (select count(*) from public.student_responses where teacher_id = $1))
  $q$;
begin
  ws := public.get_workspace_json(tid);
  select (o - 1)::int into ai
    from jsonb_array_elements(ws->'assessments') with ordinality e(a, o)
   where jsonb_array_length(coalesce(a->'questions', '[]')) >= 3
   limit 1;
  if ai is null then raise exception 'NO_ASSESSMENT_WITH_3_QUESTIONS for %', tid; end if;

  -- q0: true. q1: false (stored as absent). q2: not a boolean (absent).
  ws := jsonb_set(ws, array['assessments', ai::text, 'questions', '0', 'secondChoice'], 'true');
  ws := jsonb_set(ws, array['assessments', ai::text, 'questions', '1', 'secondChoice'], 'false');
  ws := jsonb_set(ws, array['assessments', ai::text, 'questions', '2', 'secondChoice'], '"abc"');

  execute counts into before_counts using tid;
  perform public.sync_workspace(tid, ws);
  back := public.get_workspace_json(tid);
  execute counts into after_counts using tid;

  raise exception 'ROLLED_BACK expect q0=true q1=absent q2=absent and equal counts | got q0=% q1=% q2=% | counts before=% after=%',
    coalesce(back->'assessments'->ai->'questions'->0->>'secondChoice', 'absent'),
    coalesce(back->'assessments'->ai->'questions'->1->>'secondChoice', 'absent'),
    coalesce(back->'assessments'->ai->'questions'->2->>'secondChoice', 'absent'),
    before_counts, after_counts;
end
$check$;
