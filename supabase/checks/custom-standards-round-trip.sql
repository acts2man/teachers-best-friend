-- Not a migration. Run by hand AFTER
-- supabase/migrations/20261014160000_custom_standards_one_per_code_and_extras.sql
-- has been applied. Safe on production: no DDL, and every write is inside a DO
-- block that raises at the end, so the transaction rolls back and nothing it
-- saved survives. The final ERROR line IS the result -- read it, it is not a
-- failure.
--
-- What it proves:
--   G8  -- a save holding the same custom-standard code twice (two frameworks)
--          goes through instead of failing, and keeps the FIRST copy;
--   G11 -- a custom standard's skills, prerequisites, next, vocabulary,
--          misconception, example, dok and source survive a save and a
--          reload; a dok outside 1-4 and a non-array skills are dropped rather
--          than failing the save; the teacher's other rows are untouched.
--
-- Uses made-up codes (ZZ.CHECK.*) that no real standard has. Set the teacher
-- below -- ideally your own test account, not a pilot teacher's.

set lock_timeout = '5s';
set statement_timeout = '30s';

do $check$
declare
  tid uuid := '00000000-0000-0000-0000-000000000000'; -- <-- set this
  ws jsonb;
  back jsonb;
  one jsonb;
  two jsonb;
  dup_count int;
  before_counts jsonb;
  after_counts jsonb;
  counts text := $q$
    select jsonb_build_object(
      'standards', (select count(*) from public.standards where teacher_id = $1 and code not like 'ZZ.CHECK.%'),
      'questions', (select count(*) from public.assessment_questions where teacher_id = $1),
      'students',  (select count(*) from public.students where teacher_id = $1),
      'responses', (select count(*) from public.student_responses where teacher_id = $1))
  $q$;
begin
  ws := public.get_workspace_json(tid);
  if ws is null then raise exception 'NO_WORKSPACE for %', tid; end if;
  ws := jsonb_set(ws, '{customStandards}', coalesce(ws->'customStandards', '[]') || jsonb_build_array(
    jsonb_build_object('code', 'ZZ.CHECK.1', 'title', 'Check one', 'subject', 'Math', 'grade', 3,
      'framework', 'Check A', 'summary', 'first copy',
      'skills', jsonb_build_array('arrays'), 'prerequisites', jsonb_build_array('ZZ.CHECK.0'),
      'next', jsonb_build_array('ZZ.CHECK.2'), 'vocabulary', jsonb_build_array('factor'),
      'misconception', 'adds instead of multiplying', 'example', 'three rows of four', 'dok', 3, 'source', 'check'),
    jsonb_build_object('code', 'ZZ.CHECK.1', 'title', 'Check one', 'subject', 'Math', 'grade', 3,
      'framework', 'Check B', 'summary', 'second copy'),
    jsonb_build_object('code', 'ZZ.CHECK.2', 'title', 'Check two', 'subject', 'Math', 'grade', 3,
      'framework', 'Check A', 'summary', 'bad extras', 'dok', 9, 'skills', '"not a list"')));

  execute counts into before_counts using tid;
  perform public.sync_workspace(tid, ws);
  back := public.get_workspace_json(tid);
  execute counts into after_counts using tid;

  select count(*) into dup_count from jsonb_array_elements(back->'customStandards') s where s->>'code' = 'ZZ.CHECK.1';
  select s into one from jsonb_array_elements(back->'customStandards') s where s->>'code' = 'ZZ.CHECK.1' limit 1;
  select s into two from jsonb_array_elements(back->'customStandards') s where s->>'code' = 'ZZ.CHECK.2' limit 1;

  raise exception 'ROLLED_BACK expect copies=1 framework="Check A" skills=["arrays"] prerequisites=["ZZ.CHECK.0"] next=["ZZ.CHECK.2"] vocabulary=["factor"] misconception="adds instead of multiplying" example="three rows of four" dok=3 source="check" | two: dok=2 skills=[] | equal counts | got copies=% framework=% skills=% prerequisites=% next=% vocabulary=% misconception=% example=% dok=% source=% | two: dok=% skills=% | counts before=% after=%',
    dup_count, one->'framework', one->'skills', one->'prerequisites', one->'next', one->'vocabulary',
    one->'misconception', one->'example', one->'dok', one->'source',
    two->'dok', two->'skills', before_counts, after_counts;
end
$check$;
