-- Usage is the sum of live pages reserved inside the teacher's current billing
-- window. effective_period is unchanged -- it already handles a stored window
-- that was never rolled forward.
--
-- The two-hour clause is what makes an abandoned stack stop counting without a
-- cron job. A teacher who reserves 30 pages and closes the tab mid-class-set
-- has 30 unconfirmed reservations; two hours later they stop counting and the
-- pages are free again. A confirmed page counts forever, in the period it was
-- reserved in, however long ago that was.
create or replace function public.current_period_scan_count(p_teacher uuid default auth.uid())
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with w as (select * from public.effective_period(p_teacher))
  select coalesce(sum(c.pages), 0)::int
    from public.page_charges c, w
   where c.teacher_id = p_teacher
     and c.released_at is null
     and (c.confirmed_at is not null
          or c.reserved_at > now() - interval '2 hours')
     and c.reserved_at >= w.period_start
     and c.reserved_at <  w.period_end;
$$;

comment on function public.current_period_scan_count(uuid) is
  'Pages charged inside the teacher''s current billing window. Unconfirmed reservations older than two hours are treated as abandoned and stop counting.';

-- Reserves the pages behind p_upload_ids, all or nothing.
--
-- p_gen_key covers the one charging request that has no page: a lesson plan or
-- reading passage generated from typed text still spends a model call, so it
-- charges 1 against a key unique to that scan ('gen:' || scan id). It is never
-- deduplicated, because there are no bytes to match.
create or replace function public.charge_pages(
  p_teacher uuid,
  p_upload_ids uuid[],
  p_mode text,
  p_gen_key text default null
)
returns table (charged int, already_paid int, used int, quota int, remaining int)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_quota int;
  v_used  int;
  v_new   int := 0;
  v_paid  int := 0;
  v_want  int;
  v_seen  int;
  v_todo  jsonb;
begin
  select p.scan_quota into v_quota
    from public.subscriptions sub
    join public.plans p on p.id = sub.plan_id
   where sub.teacher_id = p_teacher;
  if v_quota is null then
    raise exception 'NO_SUBSCRIPTION: teacher %', p_teacher
      using errcode = 'check_violation';
  end if;

  -- The privacy pass over pages already paid for, and the shared standards
  -- library. Refused here as well as in the routes, so a routing mistake
  -- cannot bill a name strip.
  if p_mode in ('name_strip', 'catalog') then
    v_used := public.current_period_scan_count(p_teacher);
    return query select 0, 0, v_used, v_quota, greatest(v_quota - v_used, 0);
    return;
  end if;

  -- Serializes every charge for this teacher. Two tabs, or a resumed scan
  -- racing a fresh one, queue here instead of both reading the same usage and
  -- both deciding they fit.
  perform 1 from public.subscriptions where teacher_id = p_teacher for update;

  -- Work out what this request wants, before writing anything. Held in a
  -- local value rather than a temp table: this runs on a pooled connection,
  -- and session-scoped scratch that outlives the call is how one teacher's
  -- charge ends up reading another's leftovers.
  select coalesce(jsonb_agg(jsonb_build_object(
           'h', k.h, 'p', k.pages, 'u', k.uid, 'live', k.live)), '[]'::jsonb)
    into v_todo
    from (
      select h,
             max(pages) as pages,
             min(uid)   as uid,
             bool_or(live) as live
        from (
          select coalesce(u.content_sha256, 'upload:' || u.id::text) as h,
                 u.page_count as pages,
                 u.id as uid,
                 exists (
                   select 1 from public.page_charges c
                    where c.teacher_id = p_teacher
                      and c.content_sha256 = coalesce(u.content_sha256, 'upload:' || u.id::text)
                      and c.released_at is null
                 ) as live
            from unnest(coalesce(p_upload_ids, '{}'::uuid[])) as t(uid)
            join public.teacher_uploads u on u.id = t.uid
           where u.owner_id = p_teacher
        ) rows_in
       group by h
    ) k;

  -- An id that named nothing, or named another teacher's upload, drops out of
  -- that join. Never silently skip it: charging fewer pages than were asked
  -- for is the same failure as charging none.
  select count(distinct uid) into v_want
    from unnest(coalesce(p_upload_ids, '{}'::uuid[])) as t(uid);
  select count(distinct uid) into v_seen
    from unnest(coalesce(p_upload_ids, '{}'::uuid[])) as t(uid)
    join public.teacher_uploads u on u.id = t.uid
   where u.owner_id = p_teacher;
  if v_want <> v_seen then
    raise exception 'UPLOAD_NOT_FOUND: % of % uploads are missing or not this teacher''s', v_want - v_seen, v_want
      using errcode = 'check_violation';
  end if;

  select coalesce(sum(s.p) filter (where not s.live), 0),
         coalesce(sum(s.p) filter (where s.live), 0)
    into v_new, v_paid
    from jsonb_to_recordset(v_todo) as s(h text, p int, u uuid, live boolean);

  -- A generated lesson or passage: no page, one model call, one scan.
  if v_want = 0 then
    if p_gen_key is null then
      raise exception 'NO_CHARGE_KEY: a request with no uploads needs a generation key'
        using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.page_charges c
                where c.teacher_id = p_teacher and c.content_sha256 = p_gen_key
                  and c.released_at is null) then
      v_paid := 1;
    else
      v_new := 1;
    end if;
  end if;

  v_used := public.current_period_scan_count(p_teacher);

  -- All or nothing. A teacher with 12 left who submits 30 pages starts
  -- nothing and is charged nothing, rather than grading 12 and stopping.
  if v_used + v_new > v_quota then
    raise exception 'SCAN_QUOTA_EXCEEDED: needed % remaining %', v_new, greatest(v_quota - v_used, 0)
      using errcode = 'check_violation';
  end if;

  if v_want = 0 then
    insert into public.page_charges (teacher_id, upload_id, content_sha256, pages, mode)
    values (p_teacher, null, p_gen_key, 1, p_mode)
    on conflict (teacher_id, content_sha256) do update
      set released_at = null,
          reserved_at = now(),
          mode = excluded.mode
      where page_charges.released_at is not null;
  else
    insert into public.page_charges (teacher_id, upload_id, content_sha256, pages, mode)
    select p_teacher, s.u, s.h, s.p, p_mode
      from jsonb_to_recordset(v_todo) as s(h text, p int, u uuid, live boolean)
     where not s.live
    on conflict (teacher_id, content_sha256) do update
      -- A released charge comes back to life as the same row, so the ledger
      -- keeps one row per page however many times it is retried.
      set released_at = null,
          reserved_at = now(),
          upload_id = excluded.upload_id,
          mode = excluded.mode
      where page_charges.released_at is not null;
  end if;

  v_used := public.current_period_scan_count(p_teacher);
  return query select v_new, v_paid, v_used, v_quota, greatest(v_quota - v_used, 0);
end;
$$;

comment on function public.charge_pages(uuid, uuid[], text, text) is
  'Reserves one charge per distinct page in p_upload_ids, all or nothing against the teacher''s quota. Pages with a live charge are free. Raises SCAN_QUOTA_EXCEEDED without writing anything if the whole stack does not fit.';

create or replace function public.confirm_pages(
  p_teacher uuid,
  p_upload_ids uuid[],
  p_gen_key text default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_hit int;
begin
  update public.page_charges c
     set confirmed_at = now()
   where c.teacher_id = p_teacher
     and c.confirmed_at is null
     and c.released_at is null
     and c.content_sha256 in (
       select coalesce(u.content_sha256, 'upload:' || u.id::text)
         from unnest(coalesce(p_upload_ids, '{}'::uuid[])) as t(uid)
         join public.teacher_uploads u on u.id = t.uid
        where u.owner_id = p_teacher
       union all
       select p_gen_key where p_gen_key is not null
     );
  get diagnostics v_hit = row_count;
  return v_hit;
end;
$$;

comment on function public.confirm_pages(uuid, uuid[], text) is
  'Marks reserved pages as work actually delivered. Idempotent: a replayed poll confirms nothing new.';

create or replace function public.release_pages(
  p_teacher uuid,
  p_upload_ids uuid[],
  p_gen_key text default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_hit int;
begin
  update public.page_charges c
     set released_at = now()
   where c.teacher_id = p_teacher
     -- Only ever an unconfirmed reservation. A page that graded successfully
     -- once stays charged, whatever fails afterwards.
     and c.confirmed_at is null
     and c.released_at is null
     and c.content_sha256 in (
       select coalesce(u.content_sha256, 'upload:' || u.id::text)
         from unnest(coalesce(p_upload_ids, '{}'::uuid[])) as t(uid)
         join public.teacher_uploads u on u.id = t.uid
        where u.owner_id = p_teacher
       union all
       select p_gen_key where p_gen_key is not null
     );
  get diagnostics v_hit = row_count;
  return v_hit;
end;
$$;

comment on function public.release_pages(uuid, uuid[], text) is
  'Gives back unconfirmed reservations after a failure or a cancelled stack. Confirmed pages are never refunded.';

-- Pages are charged before the model call now. Leaving the quota check here
-- would mean a teacher spending their last scan is charged for the pages and
-- then refused a scan row, with nothing graded and the pages gone. The account
-- check stays: a suspended account should still not reach the model.
create or replace function public.create_scan(
  p_teacher uuid,
  p_class_id uuid default null,
  p_student_id uuid default null,
  p_assessment_id uuid default null,
  p_upload_id uuid default null,
  p_billable boolean default true,
  p_stage text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_status text;
begin
  select status into v_status from public.profiles where id = p_teacher;
  if v_status is distinct from 'active' then
    raise exception 'ACCOUNT_SUSPENDED: teacher %', p_teacher using errcode = 'check_violation';
  end if;
  insert into public.scans (teacher_id, class_id, student_id, assessment_id, upload_id, billable, status, stage)
  values (p_teacher, p_class_id, p_student_id, p_assessment_id, p_upload_id, p_billable, 'queued', p_stage)
  returning id into v_id;
  return v_id;
end $$;

comment on function public.create_scan(uuid, uuid, uuid, uuid, uuid, boolean, text) is
  'Opens a row in the per-model-call cost log. Quota is not checked here -- charge_pages does that before the model call. scans.billable now means only "was this a teacher-facing call", not "this cost a scan".';

revoke execute on function public.charge_pages(uuid, uuid[], text, text) from public, anon, authenticated;
revoke execute on function public.confirm_pages(uuid, uuid[], text) from public, anon, authenticated;
revoke execute on function public.release_pages(uuid, uuid[], text) from public, anon, authenticated;
grant execute on function public.charge_pages(uuid, uuid[], text, text) to service_role;
grant execute on function public.confirm_pages(uuid, uuid[], text) to service_role;
grant execute on function public.release_pages(uuid, uuid[], text) to service_role;
