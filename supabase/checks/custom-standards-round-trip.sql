-- Not a migration. Run by hand AFTER
-- supabase/migrations/20261014130000_custom_standards_per_framework.sql has
-- been applied. Safe on production: no DDL, and every write is inside a DO
-- block that raises at the end, so the transaction rolls back and nothing it
-- saved survives. The final ERROR line IS the result -- read it, it is not a
-- failure.
--
-- What it proves (docs/system-map.md gaps G8 and G11; CLAUDE.md "Workspace
-- persistence"):
--   1. Two custom standards with the SAME code in different frameworks
--      (California and Common Core) both save -- the save used to fail
--      outright -- and both come back, each with its own skills.
--   2. skills, misconception, example, prerequisites, next, vocabulary, dok,
--      source and officialCode survive a save and a reload.
--   3. A payload holding two rows for the same framework + grade + subject +
--      code keeps the LAST one instead of failing the save (rule R14).
--   4. Dropping one of the pair on the next save deletes only that one: the
--      delete matches the full key, not the code.
--   5. A standard saved with nothing but the reader's defaults (skills [],
--      dok 2, the stock misconception and example -- what the app sends back
--      for a standard nobody enriched) stores NO meta, on the first save and
--      on a save of the reloaded workspace, so the defaults are not frozen.
--   6. Catalog details added to the shared library LATER reach that teacher
--      row; and on a row that has its own skills, the teacher's skills win
--      while the catalog fills the keys the teacher never set.
--   7. Catalog values are not frozen either. A standard loaded from the shared
--      catalog (v1) and saved stores only the teacher's own difference (here
--      an example), on the first save and on a resave of the reload; after the
--      catalog is refreshed to v2 the teacher sees v2, with their own example
--      still on top. This is also what every existing teacher's first save
--      after the migration does: their reload carries the catalog's values.
--   8. The teacher's other rows are untouched (counts before == after).
--
-- Steps 6-7 insert three rows into the shared catalog (framework "Common
-- Core", codes CHECK-G8.1 / CHECK-G11.1 / CHECK-G11.2) and update one; all of
-- it rolls back with everything else.
--
-- Set the teacher below to an account with a workspace -- ideally your own
-- test account, not a pilot teacher's. The block holds that teacher's rows
-- for the moment it runs; lock_timeout stops it waiting on anyone else.

set lock_timeout = '5s';
set statement_timeout = '30s';

do $check$
declare
  tid uuid := '00000000-0000-0000-0000-000000000000'; -- <-- set this
  test_code text := 'CHECK-G8.1'; -- a code no real catalog uses
  plain_code text := 'CHECK-G11.1'; -- ditto
  plain jsonb;
  plain_meta_first jsonb;
  plain_meta_resave jsonb;
  later jsonb;
  plain_later jsonb;
  cc_later jsonb;
  cat_code text := 'CHECK-G11.2'; -- ditto
  cat_meta_first jsonb;
  cat_meta_resave jsonb;
  cat_v2 jsonb;
  ws2 jsonb;
  ws jsonb;
  back jsonb;
  after_drop jsonb;
  ca jsonb;
  cc jsonb;
  cc_after jsonb;
  ca_after jsonb;
  before_counts jsonb;
  after_counts jsonb;
  counts text := $q$
    select jsonb_build_object(
      'standards', (select count(*) from public.standards where teacher_id = $1),
      'questions', (select count(*) from public.assessment_questions where teacher_id = $1),
      'students',  (select count(*) from public.students where teacher_id = $1),
      'responses', (select count(*) from public.student_responses where teacher_id = $1))
  $q$;
begin
  ws := public.get_workspace_json(tid);
  if ws is null then raise exception 'NO_WORKSPACE for %', tid; end if;
  execute counts into before_counts using tid;

  ws := jsonb_set(ws, '{customStandards}', coalesce(ws->'customStandards', '[]'::jsonb) || jsonb_build_array(
    -- An earlier California copy of the same key: the later one must win.
    jsonb_build_object('code', test_code, 'framework', 'California', 'grade', 3, 'subject', 'Math',
      'title', 'stale copy', 'summary', 'stale', 'domain', 'D', 'cluster', 'C',
      'skills', jsonb_build_array('stale skill')),
    jsonb_build_object('code', test_code, 'framework', 'California', 'grade', 3, 'subject', 'Math',
      'title', 'CA title', 'summary', 'CA wording', 'domain', 'D', 'cluster', 'C',
      'skills', jsonb_build_array('ca skill one', 'ca skill two'),
      'prerequisites', jsonb_build_array('2.OA.A.1'), 'next', jsonb_build_array('4.OA.A.1'),
      'vocabulary', jsonb_build_array('product'),
      'misconception', 'CA misconception', 'example', 'CA example',
      'dok', 3, 'source', 'CA source', 'officialCode', '3.OA.1'),
    jsonb_build_object('code', test_code, 'framework', 'Common Core', 'grade', 3, 'subject', 'Math',
      'title', 'CC title', 'summary', 'CC wording', 'domain', 'D', 'cluster', 'C',
      'skills', jsonb_build_array('cc skill'),
      'misconception', 'CC misconception', 'example', 'CC example',
      -- Bad values are dropped, never fail the save (R13).
      'dok', 'not a number', 'prerequisites', 'not an array')));

  perform public.sync_workspace(tid, ws);
  back := public.get_workspace_json(tid);
  select s into ca from jsonb_array_elements(back->'customStandards') s
   where s->>'code' = test_code and s->>'framework' = 'California';
  select s into cc from jsonb_array_elements(back->'customStandards') s
   where s->>'code' = test_code and s->>'framework' = 'Common Core';

  -- Next save without the California one: only it goes.
  perform public.sync_workspace(tid, jsonb_set(back, '{customStandards}', coalesce((
    select jsonb_agg(s) from jsonb_array_elements(back->'customStandards') s
     where not (s->>'code' = test_code and s->>'framework' = 'California')), '[]'::jsonb)));
  after_drop := public.get_workspace_json(tid);
  select s into ca_after from jsonb_array_elements(after_drop->'customStandards') s
   where s->>'code' = test_code and s->>'framework' = 'California';
  select s into cc_after from jsonb_array_elements(after_drop->'customStandards') s
   where s->>'code' = test_code and s->>'framework' = 'Common Core';
  -- A standard carrying only the defaults the app fills in (normalizeStandard
  -- writes the curly apostrophe; get_workspace_json writes a straight one).
  plain := jsonb_build_object('code', plain_code, 'framework', 'Common Core', 'grade', 3, 'subject', 'Math',
    'title', 'Plain', 'summary', 'Plain wording', 'domain', 'D', 'cluster', 'C',
    'skills', '[]'::jsonb, 'prerequisites', '[]'::jsonb, 'next', '[]'::jsonb, 'vocabulary', '[]'::jsonb,
    'misconception', 'Use the student’s written reasoning to identify the step that needs support.',
    'example', 'Choose a task that directly demonstrates this standard.',
    'dok', 2, 'source', '');
  perform public.sync_workspace(tid, jsonb_set(after_drop, '{customStandards}',
    coalesce(after_drop->'customStandards', '[]'::jsonb) || jsonb_build_array(plain)));
  select meta into plain_meta_first from public.standards
   where teacher_id = tid and code = plain_code and framework = 'Common Core';
  -- Save exactly what the reload hands back (the reader's own defaults).
  perform public.sync_workspace(tid, public.get_workspace_json(tid));
  select meta into plain_meta_resave from public.standards
   where teacher_id = tid and code = plain_code and framework = 'Common Core';

  -- The shared catalog learns more about both standards afterwards.
  insert into public.standards (teacher_id, jurisdiction, framework, subject, grade, code, description, meta)
  values
    (null, 'CA', 'Common Core', 'Math', '3', plain_code, 'catalog row',
     jsonb_build_object('skills', jsonb_build_array('catalog skill'), 'prerequisites', jsonb_build_array('catalog prereq'),
       'misconception', 'catalog misconception', 'example', 'catalog example', 'dok', 3)),
    (null, 'CA', 'Common Core', 'Math', '3', test_code, 'catalog row',
     jsonb_build_object('skills', jsonb_build_array('catalog skill'), 'prerequisites', jsonb_build_array('catalog prereq')));
  later := public.get_workspace_json(tid);
  select s into plain_later from jsonb_array_elements(later->'customStandards') s
   where s->>'code' = plain_code and s->>'framework' = 'Common Core';
  select s into cc_later from jsonb_array_elements(later->'customStandards') s
   where s->>'code' = test_code and s->>'framework' = 'Common Core';

  -- Step 7: the catalog has v1; the teacher loads it (StandardsLoader copies
  -- the catalog row whole) and adds an example of their own.
  insert into public.standards (teacher_id, jurisdiction, framework, subject, grade, code, description, meta)
  values (null, 'CA', 'Common Core', 'Math', '3', cat_code, 'catalog row',
    jsonb_build_object('skills', jsonb_build_array('v1 skill'), 'misconception', 'v1 misc', 'dok', 3));
  perform public.sync_workspace(tid, jsonb_set(later, '{customStandards}',
    coalesce(later->'customStandards', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'code', cat_code, 'framework', 'Common Core', 'grade', 3, 'subject', 'Math',
      'title', 'Loaded', 'summary', 'Loaded wording', 'domain', 'D', 'cluster', 'C',
      'skills', jsonb_build_array('v1 skill'), 'prerequisites', '[]'::jsonb, 'next', '[]'::jsonb,
      'vocabulary', '[]'::jsonb, 'misconception', 'v1 misc', 'example', 'teacher example',
      'dok', 3, 'source', ''))));
  select meta into cat_meta_first from public.standards
   where teacher_id = tid and code = cat_code and framework = 'Common Core';
  perform public.sync_workspace(tid, public.get_workspace_json(tid));
  select meta into cat_meta_resave from public.standards
   where teacher_id = tid and code = cat_code and framework = 'Common Core';
  -- An admin refreshes the catalog.
  update public.standards set meta = jsonb_build_object('skills', jsonb_build_array('v2 skill'), 'misconception', 'v2 misc', 'dok', 4)
   where teacher_id is null and code = cat_code and framework = 'Common Core';
  ws2 := public.get_workspace_json(tid);
  select s into cat_v2 from jsonb_array_elements(ws2->'customStandards') s
   where s->>'code' = cat_code and s->>'framework' = 'Common Core';

  -- Clean up our rows so the counts compare like for like.
  perform public.sync_workspace(tid, jsonb_set(ws2, '{customStandards}', coalesce((
    select jsonb_agg(s) from jsonb_array_elements(ws2->'customStandards') s
     where s->>'code' not in (test_code, plain_code, cat_code)), '[]'::jsonb)));
  execute counts into after_counts using tid;

  raise exception E'ROLLED_BACK expect both=true | CA skills=["ca skill one", "ca skill two"] misconception="CA misconception" example="CA example" prerequisites=["2.OA.A.1"] next=["4.OA.A.1"] vocabulary=["product"] dok=3 source="CA source" officialCode="3.OA.1" | CC skills=["cc skill"] misconception="CC misconception" example="CC example" dok=2 prerequisites=[] | after dropping CA: CA=absent CC=present | defaults-only meta: first=absent resave=absent | catalog later: plain skills=["catalog skill"] prerequisites=["catalog prereq"] misconception="catalog misconception" example="catalog example" dok=3; CC skills=["cc skill"] prerequisites=["catalog prereq"] misconception="CC misconception" | catalog refresh: meta first={"example": "teacher example"} resave={"example": "teacher example"} after v2 skills=["v2 skill"] misconception="v2 misc" dok=4 example="teacher example" | equal counts\n got both=% | CA skills=% misconception=% example=% prerequisites=% next=% vocabulary=% dok=% source=% officialCode=% | CC skills=% misconception=% example=% dok=% prerequisites=% | after dropping CA: CA=% CC=% | defaults-only meta: first=% resave=% | catalog later: plain skills=% prerequisites=% misconception=% example=% dok=%; CC skills=% prerequisites=% misconception=% | catalog refresh: meta first=% resave=% after v2 skills=% misconception=% dok=% example=% | counts before=% after=%',
    (ca is not null and cc is not null),
    ca->'skills', ca->'misconception', ca->'example', ca->'prerequisites', ca->'next', ca->'vocabulary',
    ca->'dok', ca->'source', coalesce(ca->'officialCode', '"absent"'),
    cc->'skills', cc->'misconception', cc->'example', cc->'dok', cc->'prerequisites',
    case when ca_after is null then 'absent' else 'present' end,
    case when cc_after is null then 'absent' else 'present' end,
    coalesce(plain_meta_first::text, 'absent'), coalesce(plain_meta_resave::text, 'absent'),
    plain_later->'skills', plain_later->'prerequisites', plain_later->'misconception', plain_later->'example', plain_later->'dok',
    cc_later->'skills', cc_later->'prerequisites', cc_later->'misconception',
    coalesce(cat_meta_first::text, 'absent'), coalesce(cat_meta_resave::text, 'absent'),
    cat_v2->'skills', cat_v2->'misconception', cat_v2->'dok', cat_v2->'example',
    before_counts, after_counts;
end
$check$;
