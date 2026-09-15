-- Pin search_path on the two trigger helpers that were missing it
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.assign_ticket_ref()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.ticket_ref is null then
    new.ticket_ref := 'TKT-' || lpad(nextval('public.ticket_ref_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------
-- Nothing internal should be callable over the REST API.
-- Trigger functions and service-role jobs get revoked outright.
-- ---------------------------------------------------------------
revoke execute on function public.handle_new_user()               from anon, authenticated;
revoke execute on function public.touch_updated_at()              from anon, authenticated;
revoke execute on function public.assign_ticket_ref()             from anon, authenticated;
revoke execute on function public.guard_scan_insert()             from anon, authenticated;
revoke execute on function public.enforce_scan_quota()            from anon, authenticated;
revoke execute on function public.compute_scan_cost()             from anon, authenticated;
revoke execute on function public.purge_expired_uploads()         from anon, authenticated;
revoke execute on function public.purge_expired_student_notes()   from anon, authenticated;
revoke execute on function public.record_reteaching_hit(uuid)     from anon, authenticated;

-- These took a teacher_id argument, which let any signed-in user read
-- another teacher's usage. Lock them to the service role.
revoke execute on function public.current_period_scan_count(uuid) from anon, authenticated;
revoke execute on function public.scan_quota_status(uuid)         from anon, authenticated;

-- ---------------------------------------------------------------
-- Safe, caller-scoped replacement for the client.
-- No argument, so there is nothing to spoof.
-- ---------------------------------------------------------------
create or replace function public.my_scan_quota()
returns table (plan_id text, quota integer, used integer, remaining integer, can_scan boolean)
language sql
stable
security definer
set search_path = public
as $$
  select p.id,
         p.scan_quota,
         public.current_period_scan_count(auth.uid()),
         greatest(p.scan_quota - public.current_period_scan_count(auth.uid()), 0),
         public.current_period_scan_count(auth.uid()) < p.scan_quota
    from public.subscriptions sub
    join public.plans p on p.id = sub.plan_id
   where sub.teacher_id = auth.uid();
$$;

revoke execute on function public.my_scan_quota() from anon, public;
grant  execute on function public.my_scan_quota() to authenticated;
