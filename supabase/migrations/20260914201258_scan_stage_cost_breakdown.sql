-- Record which kind of work produced each scan, so cost can be explained
-- in plain terms (student worksheet scan, assignment read, lesson plan…).
alter table public.scans add column if not exists stage text;
comment on column public.scans.stage is 'Kind of work: assignment, responses, answer_key, lesson, reteaching, catalog, roster, support';

-- create_scan now takes p_stage. The old signature is dropped so a call
-- without p_stage resolves to this one (default null) instead of being ambiguous.
drop function if exists public.create_scan(uuid, uuid, uuid, uuid, uuid, boolean);
create or replace function public.create_scan(
  p_teacher uuid, p_class_id uuid default null, p_student_id uuid default null,
  p_assessment_id uuid default null, p_upload_id uuid default null,
  p_billable boolean default true, p_stage text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_quota int; v_used int; v_id uuid; v_status text;
begin
  select status into v_status from public.profiles where id = p_teacher;
  if v_status is distinct from 'active' then
    raise exception 'ACCOUNT_SUSPENDED: teacher %', p_teacher using errcode = 'check_violation';
  end if;
  if p_billable then
    select p.scan_quota into v_quota from public.subscriptions sub
      join public.plans p on p.id = sub.plan_id where sub.teacher_id = p_teacher;
    if v_quota is null then
      raise exception 'NO_SUBSCRIPTION: teacher %', p_teacher using errcode = 'check_violation';
    end if;
    v_used := public.current_period_scan_count(p_teacher);
    if v_used >= v_quota then
      raise exception 'SCAN_QUOTA_EXCEEDED: % of % used', v_used, v_quota using errcode = 'check_violation';
    end if;
  end if;
  insert into public.scans (teacher_id, class_id, student_id, assessment_id, upload_id, billable, status, stage)
  values (p_teacher, p_class_id, p_student_id, p_assessment_id, p_upload_id, p_billable, 'queued', p_stage)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.create_scan(uuid,uuid,uuid,uuid,uuid,boolean,text) from public, anon, authenticated;
grant execute on function public.create_scan(uuid,uuid,uuid,uuid,uuid,boolean,text) to service_role;

-- Older scans: infer the kind of work from what they were linked to.
update public.scans set stage = case
  when student_id is not null then 'responses'
  when reteach_model is not null then 'lesson'
  when assessment_id is not null then 'assignment'
end where stage is null;

-- Scans that were queued but never finished (the request died before a
-- result was recorded) are closed out so they stop looking in-flight.
update public.scans
   set status = 'canceled', completed_at = now(),
       error = 'Never finished: the request ended before a result was recorded.'
 where status = 'queued' and created_at < now() - interval '1 hour';

-- Cost grouped by kind of work and model, per teacher and month.
create or replace view public.admin_cost_breakdown as
select s.teacher_id,
       date_trunc('month', s.created_at)::date as period,
       coalesce(s.stage, 'unknown') as stage,
       coalesce(s.extract_model, s.reteach_model, 'unknown') as model,
       count(*)::int as calls,
       count(*) filter (where s.status = 'complete')::int as completed,
       count(*) filter (where s.status in ('failed','canceled'))::int as failed,
       coalesce(sum(s.cost_usd), 0) as cost_usd,
       avg(s.cost_usd) filter (where s.status = 'complete') as avg_cost_complete
  from public.scans s
 group by 1, 2, 3, 4;
revoke all on public.admin_cost_breakdown from public, anon, authenticated;
grant select on public.admin_cost_breakdown to service_role;

-- Audited cleanup: remove failed and canceled scans from one account.
-- The audit entry keeps the count, the money they cost, and the distinct errors.
create or replace function public.admin_clear_failed_scans(p_actor uuid, p_teacher uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n int; v_cost numeric; v_errors jsonb;
begin
  if not public.is_admin(p_actor) then raise exception 'NOT_ADMIN'; end if;
  select count(*), coalesce(sum(cost_usd), 0), coalesce(jsonb_agg(distinct left(error, 140)), '[]'::jsonb)
    into v_n, v_cost, v_errors
    from public.scans where teacher_id = p_teacher and status in ('failed', 'canceled');
  delete from public.scans where teacher_id = p_teacher and status in ('failed', 'canceled');
  perform public.admin_log(p_actor, 'clear_failed_scans', 'teacher', p_teacher::text,
    jsonb_build_object('removed', v_n, 'cost_usd', v_cost, 'errors', v_errors));
  return v_n;
end $$;
revoke all on function public.admin_clear_failed_scans(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_clear_failed_scans(uuid, uuid) to service_role;
