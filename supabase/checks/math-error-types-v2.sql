-- Not a migration. Run by hand BEFORE
-- supabase/migrations/20261027120000_math_error_types_v2.sql is applied -- by
-- the reviewer, not by the PR's author. Pending until then.
-- Safe on production: it runs that migration's statements (copied below,
-- verbatim -- tests/math-error-types.test.mjs fails if they drift) inside a
-- DO block that raises at the end, so the transaction rolls back: the new
-- columns, the cleared tags, the bumped revisions and the save below are all
-- undone. The final ERROR line IS the result -- read it, it is not a failure.
--
-- What it proves:
--   grades_changed = 0     no answer, credit, verdict or confidence moved
--   legacy_mismatch = 0    each legacy copy equals the tag it replaced
--   not_cleared = 0        no old-list tag is left on a Math/Mixed answer
--   others_changed = 0     no other subject's answer was touched
--   revisions = N of N     every teacher with a moved tag, and only they
--   other_round_trip = ok  a typed "Other: <label>" survives sync_workspace +
--                          get_workspace_json, and that save keeps the legacy
--                          copies (sync_workspace never names them)
--
-- Set the teacher below to an account with at least one graded Math answer
-- (ideally your own test account). lock_timeout stops it waiting on anyone.

set lock_timeout = '5s';
set statement_timeout = '60s';

do $check$
declare
  tid uuid := '00000000-0000-0000-0000-000000000000'; -- <-- set this
  ws jsonb;
  back jsonb;
  ai int;
  ri int;
  rid text;
  label text := 'Other: Forgot to distribute';
  grades_changed int;
  legacy_mismatch int;
  not_cleared int;
  others_changed int;
  rev_expected int;
  rev_bumped int;
  rev_wrong int;
  legacy_before jsonb;
  legacy_after jsonb;
  round_trip text;
begin
  create temp table chk_before on commit drop as
    select r.id, r.teacher_id, a.subject, r.error_type, r.suggested_error_type, r.answer,
           r.final_answer, r.correct, r.match_score, r.verified, r.confidence, r.graded_alone
    from public.student_responses r join public.assessments a on a.id = r.assessment_id;
  create temp table chk_rev on commit drop as
    select owner_id, revision from public.teacher_workspaces;
  create temp table chk_old(name) on commit drop as
    values ('Algebraic/Arithmetic error'), ('Sign error'), ('Conceptual/Setup error'),
           ('Wrong formula'), ('Graph/Table interpretation error');
  select count(distinct teacher_id) into rev_expected from chk_before
    where subject in ('Math', 'Mixed')
      and (error_type in (select name from chk_old) or suggested_error_type in (select name from chk_old));

  -- ---- 20261027120000_math_error_types_v2.sql, verbatim from here ----
  alter table public.student_responses
    add column if not exists legacy_error_type text,
    add column if not exists legacy_suggested_error_type text;

with old(name) as (
  values ('Algebraic/Arithmetic error'), ('Sign error'), ('Conceptual/Setup error'),
         ('Wrong formula'), ('Graph/Table interpretation error')
), moved as (
  update public.student_responses r set
    legacy_error_type = case when r.error_type in (select name from old)
      then r.error_type else r.legacy_error_type end,
    legacy_suggested_error_type = case when r.suggested_error_type in (select name from old)
      then r.suggested_error_type else r.legacy_suggested_error_type end,
    error_type = case when r.error_type in (select name from old) then null else r.error_type end,
    suggested_error_type = case when r.suggested_error_type in (select name from old)
      then null else r.suggested_error_type end
  from public.assessments a
  where a.id = r.assessment_id
    and a.subject in ('Math', 'Mixed')
    and (r.error_type in (select name from old) or r.suggested_error_type in (select name from old))
  returning r.teacher_id
)
update public.teacher_workspaces w set revision = w.revision + 1
where w.owner_id in (select distinct teacher_id from moved);
  -- ---- to here ----

  execute $q$
    select count(*) from chk_before b join public.student_responses r using (id)
    where r.answer is distinct from b.answer or r.final_answer is distinct from b.final_answer
       or r.correct is distinct from b.correct or r.match_score is distinct from b.match_score
       or r.verified is distinct from b.verified or r.confidence is distinct from b.confidence
       or r.graded_alone is distinct from b.graded_alone
  $q$ into grades_changed;
  execute $q$
    select count(*) from chk_before b join public.student_responses r using (id)
    where b.subject in ('Math', 'Mixed')
      and ((b.error_type in (select name from chk_old) and r.legacy_error_type is distinct from b.error_type)
        or (b.suggested_error_type in (select name from chk_old)
            and r.legacy_suggested_error_type is distinct from b.suggested_error_type))
  $q$ into legacy_mismatch;
  execute $q$
    select count(*) from chk_before b join public.student_responses r using (id)
    where b.subject in ('Math', 'Mixed')
      and (r.error_type in (select name from chk_old) or r.suggested_error_type in (select name from chk_old))
  $q$ into not_cleared;
  execute $q$
    select count(*) from chk_before b join public.student_responses r using (id)
    where b.subject not in ('Math', 'Mixed')
      and (r.error_type is distinct from b.error_type
        or r.suggested_error_type is distinct from b.suggested_error_type
        or r.legacy_error_type is not null or r.legacy_suggested_error_type is not null)
  $q$ into others_changed;
  select count(*) filter (where w.revision = c.revision + 1),
         count(*) filter (where w.revision <> c.revision
           and w.revision <> c.revision + 1)
    into rev_bumped, rev_wrong
    from public.teacher_workspaces w join chk_rev c using (owner_id);
  -- (any revision that moved must belong to a teacher with a moved tag)
  select rev_wrong + count(*) into rev_wrong
    from public.teacher_workspaces w join chk_rev c using (owner_id)
    where w.revision <> c.revision
      and w.owner_id not in (select teacher_id from chk_before
        where subject in ('Math', 'Mixed')
          and (error_type in (select name from chk_old) or suggested_error_type in (select name from chk_old)));

  -- A typed "Other" label, saved and read back the way the app does it.
  ws := public.get_workspace_json(tid);
  ai := null;
  for i in 0 .. coalesce(jsonb_array_length(ws->'assessments'), 0) - 1 loop
    if ws->'assessments'->i->>'subject' = 'Math'
       and jsonb_array_length(coalesce(ws->'assessments'->i->'responses', '[]')) > 0 then
      ai := i;
      exit;
    end if;
  end loop;
  if ai is null then
    raise exception 'NEEDS_A_MATH_ANSWER for %', tid;
  end if;
  ri := 0;
  rid := ws->'assessments'->ai->'responses'->ri->>'id';
  execute $q$
    select coalesce(jsonb_agg(jsonb_build_array(id, legacy_error_type, legacy_suggested_error_type) order by id), '[]')
    from public.student_responses where teacher_id = $1
  $q$ into legacy_before using tid;
  ws := jsonb_set(ws, array['assessments', ai::text, 'responses', ri::text, 'errorType'], to_jsonb(label));
  perform public.sync_workspace(tid, ws);
  back := public.get_workspace_json(tid);
  execute $q$
    select coalesce(jsonb_agg(jsonb_build_array(id, legacy_error_type, legacy_suggested_error_type) order by id), '[]')
    from public.student_responses where teacher_id = $1
  $q$ into legacy_after using tid;
  select case when x->>'errorType' = label then 'ok' else 'LOST (got ' || coalesce(x->>'errorType', 'absent') || ')' end
    into round_trip
    from jsonb_array_elements(back->'assessments'->ai->'responses') x
    where x->>'id' = rid;

  raise exception 'ROLLED_BACK expect 0 / 0 / 0 / 0 / % of % with 0 wrong / ok / legacy kept | grades_changed=% legacy_mismatch=% not_cleared=% others_changed=% revisions=% of % (wrong=%) other_round_trip=% legacy_kept_on_save=%',
    rev_expected, rev_expected,
    grades_changed, legacy_mismatch, not_cleared, others_changed, rev_bumped, rev_expected, rev_wrong,
    coalesce(round_trip, 'RESPONSE MISSING'), (legacy_before = legacy_after);
end
$check$;
