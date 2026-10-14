-- Not a migration. Run by hand AFTER
-- supabase/migrations/20261013120000_response_graded_alone.sql has been applied.
-- Safe on production: no DDL, and every write is inside a DO block that raises
-- at the end, so the transaction rolls back and nothing it saved survives. The
-- final ERROR line IS the result -- read it, it is not a failure.
--
-- What it proves (CLAUDE.md, "Workspace persistence"): StudentResponse.gradedAlone
-- survives a save and a reload through sync_workspace / get_workspace_json, and
-- a value other than true is dropped instead of failing the whole save, and a
-- stored true is cleared by the next save without it ("Back into the group").
--
-- Set the teacher below to an account whose workspace has an assessment with
-- at least 3 student responses -- ideally your own test account, not a pilot
-- teacher's. lock_timeout stops it waiting on anyone else.

set lock_timeout = '5s';
set statement_timeout = '30s';

do $check$
declare
  tid uuid := '00000000-0000-0000-0000-000000000000'; -- <-- set this
  ws jsonb;
  back jsonb;
  cleared jsonb;
  ri int;
  ai int;
  ids text[];
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
   where jsonb_array_length(coalesce(a->'responses', '[]')) >= 3
   limit 1;
  if ai is null then raise exception 'NO_ASSESSMENT_WITH_3_RESPONSES for %', tid; end if;
  select array_agg(x->>'id' order by o) into ids
    from jsonb_array_elements(ws->'assessments'->ai->'responses') with ordinality e(x, o)
   where o <= 3;

  -- r0: true. r1: false (stored as absent). r2: not a boolean (absent).
  ws := jsonb_set(ws, array['assessments', ai::text, 'responses', '0', 'gradedAlone'], 'true');
  ws := jsonb_set(ws, array['assessments', ai::text, 'responses', '1', 'gradedAlone'], 'false');
  ws := jsonb_set(ws, array['assessments', ai::text, 'responses', '2', 'gradedAlone'], '"abc"');

  execute counts into before_counts using tid;
  perform public.sync_workspace(tid, ws);
  back := public.get_workspace_json(tid);
  -- "Back into the group" on r0: the next save no longer carries the mark.
  select (o - 1)::int into ri
    from jsonb_array_elements(back->'assessments'->ai->'responses') with ordinality e(x, o)
   where x->>'id' = ids[1];
  perform public.sync_workspace(tid, jsonb_set(back, array['assessments', ai::text, 'responses', ri::text],
    (back->'assessments'->ai->'responses'->ri) - 'gradedAlone'));
  cleared := public.get_workspace_json(tid);
  execute counts into after_counts using tid;

  -- Read back by response id, not position: the reload orders responses itself.
  raise exception 'ROLLED_BACK expect r0=true r1=absent r2=absent r0_after_back=absent and equal counts | got r0=% r1=% r2=% r0_after_back=% | counts before=% after=%',
    coalesce((select x->>'gradedAlone' from jsonb_array_elements(back->'assessments'->ai->'responses') x where x->>'id' = ids[1]), 'absent'),
    coalesce((select x->>'gradedAlone' from jsonb_array_elements(back->'assessments'->ai->'responses') x where x->>'id' = ids[2]), 'absent'),
    coalesce((select x->>'gradedAlone' from jsonb_array_elements(back->'assessments'->ai->'responses') x where x->>'id' = ids[3]), 'absent'),
    coalesce((select x->>'gradedAlone' from jsonb_array_elements(cleared->'assessments'->ai->'responses') x where x->>'id' = ids[1]), 'absent'),
    before_counts, after_counts;
end
$check$;
