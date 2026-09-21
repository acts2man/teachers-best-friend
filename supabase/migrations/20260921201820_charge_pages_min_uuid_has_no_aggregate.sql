-- charge_pages grouped the request's uploads by content hash and took
-- min(uid) to keep one upload id per page for tracing. Postgres has no min()
-- aggregate over uuid, so the whole function raised 42883 the first time it
-- was given any upload at all.
--
-- It was created without complaint: a plpgsql body is not planned until it
-- runs. Nothing in the repository would have caught this either -- the JS
-- harness has no database -- which is what supabase/checks/page-charges.sql
-- is for. It found this on its first run, before any of it reached a teacher.
--
-- Ordered via text, which is a total order over uuid and only decides which
-- of several identical pages is recorded as the one that paid.
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
             -- min() has no uuid aggregate; text is a total order over uuid
             -- and this only picks which of several identical pages is
             -- recorded as the one that paid.
             min(uid::text)::uuid as uid,
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

revoke execute on function public.charge_pages(uuid, uuid[], text, text) from public, anon, authenticated;
grant execute on function public.charge_pages(uuid, uuid[], text, text) to service_role;
