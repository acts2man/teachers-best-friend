-- Not a migration. Run by hand AFTER
-- supabase/migrations/20261014160000_custom_standards_one_per_code_and_extras.sql
-- has been applied. Safe on production: no DDL, and every write is inside a DO
-- block that raises at the end, so the transaction rolls back and nothing it
-- saved survives -- the made-up catalog row it adds included. The final ERROR
-- line IS the result -- read it, it is not a failure.
--
-- What it proves:
--   G8  -- a save holding the same custom-standard code twice (two frameworks)
--          goes through instead of failing, and keeps the FIRST copy; an entry
--          without a code no longer stops removed standards being deleted;
--   G11 -- a custom standard's own skills, prerequisites, next, vocabulary,
--          misconception, example, dok and source survive a save and a
--          reload; a dok outside 1-4 and a non-list skills are dropped rather
--          than failing the save;
--   and the shared catalog still reaches a custom copy: values the teacher's
--   copy did not change are not frozen by a save (a catalog refresh shows
--   through), and a copy with only some values of its own keeps the catalog's
--   other values. The teacher's other rows are untouched.
--
-- Uses made-up codes (ZZ.CHECK.*) and frameworks ("Check A/B") that no real
-- standard has. Set the teacher below -- ideally your own test account, not a
-- pilot teacher's.

set lock_timeout = '5s';
set statement_timeout = '30s';

do $check$
declare
  tid uuid := '00000000-0000-0000-0000-000000000000'; -- <-- set this
  ws jsonb;
  back jsonb;
  later jsonb;
  one jsonb;
  two jsonb;
  three jsonb;
  four jsonb;
  stored3 jsonb;
  stored4 jsonb;
  shared_before jsonb;
  shared_after jsonb;
  dup_count int;
  two_after int;
  before_counts jsonb;
  after_counts jsonb;
  counts text := $q$
    select jsonb_build_object(
      'standards', (select count(*) from public.standards where teacher_id = $1 and code not like 'ZZ.CHECK.%'),
      'questions', (select count(*) from public.assessment_questions where teacher_id = $1),
      'students',  (select count(*) from public.students where teacher_id = $1),
      'responses', (select count(*) from public.student_responses where teacher_id = $1))
  $q$;
  std text := $s$ select s from jsonb_array_elements($1->'customStandards') s where s->>'code' = $2 limit 1 $s$;
begin
  ws := public.get_workspace_json(tid);
  if ws is null then raise exception 'NO_WORKSPACE for %', tid; end if;
  -- The shared library as the teacher sees it, to prove the read did not
  -- change it (review: the catalog merge must not touch shared rows).
  shared_before := ws->'sharedStandards';
  -- A made-up shared-catalog row for ZZ.CHECK.3 and ZZ.CHECK.4.
  insert into public.standards (teacher_id, framework, subject, grade, code, description, meta)
  values (null, 'Check A', 'Math', '3', 'ZZ.CHECK.3', 'catalog wording',
          '{"skills":["catalog skill"],"misconception":"catalog misconception","example":"catalog example","dok":3}'),
         (null, 'Check A', 'Math', '3', 'ZZ.CHECK.4', 'catalog wording',
          '{"misconception":"catalog misconception","source":"catalog source"}');

  ws := jsonb_set(ws, '{customStandards}', coalesce(ws->'customStandards', '[]') || jsonb_build_array(
    jsonb_build_object('code', 'ZZ.CHECK.1', 'title', 'Check one', 'subject', 'Math', 'grade', 3,
      'framework', 'Check A', 'summary', 'first copy',
      'skills', jsonb_build_array('arrays'), 'prerequisites', jsonb_build_array('ZZ.CHECK.0'),
      'next', jsonb_build_array('ZZ.CHECK.2'), 'vocabulary', jsonb_build_array('factor'),
      'misconception', 'adds instead of multiplying', 'example', 'three rows of four', 'dok', 3, 'source', 'check'),
    jsonb_build_object('code', 'ZZ.CHECK.1', 'title', 'Check one', 'subject', 'Math', 'grade', 3,
      'framework', 'Check B', 'summary', 'second copy'),
    jsonb_build_object('code', 'ZZ.CHECK.2', 'title', 'Check two', 'subject', 'Math', 'grade', 3,
      'framework', 'Check A', 'summary', 'bad extras', 'dok', 9, 'skills', '"not a list"'),
    -- What the app sends back for a catalog copy: every catalog value, plus one of its own.
    jsonb_build_object('code', 'ZZ.CHECK.3', 'title', 'Check three', 'subject', 'Math', 'grade', 3,
      'framework', 'Check A', 'summary', 'catalog copy', 'skills', jsonb_build_array('catalog skill'),
      'misconception', 'catalog misconception', 'example', 'own example', 'dok', 3),
    -- Only some values of its own; for the rest, what the read showed: the
    -- catalog's misconception and source, and the defaults where the catalog
    -- has none (dok 2, the default example).
    jsonb_build_object('code', 'ZZ.CHECK.4', 'title', 'Check four', 'subject', 'Math', 'grade', 3,
      'framework', 'Check A', 'summary', 'partial', 'skills', jsonb_build_array('own skill'), 'dok', 2,
      'misconception', 'catalog misconception', 'source', 'catalog source',
      'example', 'Choose a task that directly demonstrates this standard.')));

  execute counts into before_counts using tid;
  perform public.sync_workspace(tid, ws);
  back := public.get_workspace_json(tid);
  execute counts into after_counts using tid;
  select meta into stored3 from public.standards where teacher_id = tid and code = 'ZZ.CHECK.3';
  select meta into stored4 from public.standards where teacher_id = tid and code = 'ZZ.CHECK.4';

  select count(*) into dup_count from jsonb_array_elements(back->'customStandards') s where s->>'code' = 'ZZ.CHECK.1';
  execute std into one using back, 'ZZ.CHECK.1';
  execute std into two using back, 'ZZ.CHECK.2';
  execute std into four using back, 'ZZ.CHECK.4';

  -- The catalog is refreshed; the next reload shows it through the copy, and
  -- a save from that reload does not freeze it. (A page loaded BEFORE the
  -- refresh and saved after it does store the old values as the teacher's --
  -- a residual, see docs/system-map.md G11.)
  update public.standards set meta = meta || '{"misconception":"refreshed misconception","dok":4}'
   where teacher_id is null and code = 'ZZ.CHECK.3' and framework = 'Check A';
  later := public.get_workspace_json(tid);
  -- And a save with one entry missing its code, and ZZ.CHECK.2 removed.
  perform public.sync_workspace(tid, jsonb_set(later, '{customStandards}',
    (select jsonb_agg(s) from jsonb_array_elements(later->'customStandards') s where s->>'code' <> 'ZZ.CHECK.2')
      || '[{"title":"no code","subject":"Math","grade":3,"framework":"Check A","summary":"x"}]'::jsonb));
  later := public.get_workspace_json(tid);
  execute std into three using later, 'ZZ.CHECK.3';
  select coalesce(jsonb_agg(x), '[]'::jsonb) into shared_after
    from jsonb_array_elements(later->'sharedStandards') x where x->>'code' not like 'ZZ.CHECK.%';
  select count(*) into two_after from public.standards where teacher_id = tid and code = 'ZZ.CHECK.2';

  raise exception E'ROLLED_BACK\n  one: expect copies=1 framework="Check A" skills=["arrays"] prerequisites=["ZZ.CHECK.0"] next=["ZZ.CHECK.2"] vocabulary=["factor"] misconception="adds instead of multiplying" example="three rows of four" dok=3 source="check"\n       got    copies=% framework=% skills=% prerequisites=% next=% vocabulary=% misconception=% example=% dok=% source=%\n  two: expect dok=2 skills=[]  got dok=% skills=%  | removed later: expect 0 rows, got %\n  three: expect stored {"example": "own example"}, got %; after the catalog refresh expect misconception="refreshed misconception" dok=4 example="own example" skills=["catalog skill"], got % % % %\n  four: expect stored {"skills": ["own skill"]}, got %; read skills=["own skill"] misconception="catalog misconception" source="catalog source" dok=2, got % % % %\n  counts: expect equal, before=% after=%\n  shared library unchanged: expect true, got %',
    dup_count, one->'framework', one->'skills', one->'prerequisites', one->'next', one->'vocabulary',
    one->'misconception', one->'example', one->'dok', one->'source',
    two->'dok', two->'skills', two_after,
    stored3, three->'misconception', three->'dok', three->'example', three->'skills',
    stored4, four->'skills', four->'misconception', four->'source', four->'dok',
    before_counts, after_counts, shared_before = shared_after;
end
$check$;
