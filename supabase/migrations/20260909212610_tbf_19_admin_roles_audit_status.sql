-- ---------------------------------------------------------------
-- ADMIN ROLE + ACCOUNT STATUS
-- ---------------------------------------------------------------
alter table public.profiles add column if not exists is_admin boolean not null default false;
alter table public.profiles add column if not exists status text not null default 'active'
  check (status in ('active','suspended','deactivated'));
alter table public.profiles add column if not exists status_reason text;
alter table public.profiles add column if not exists last_seen_at timestamptz;
alter table public.profiles add column if not exists internal_notes text;

comment on column public.profiles.is_admin is
  'Platform administrator. Checked server-side before any admin route runs.
   Never writable by the user — no RLS policy grants update on this column.';

-- Users may update their own profile but never their own role or status
create or replace function public.guard_profile_self_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.is_admin      := old.is_admin;
    new.status        := old.status;
    new.status_reason := old.status_reason;
    new.internal_notes:= old.internal_notes;
  end if;
  return new;
end; $$;

drop trigger if exists profiles_guard_self on public.profiles;
create trigger profiles_guard_self before update on public.profiles
  for each row execute function public.guard_profile_self_update();

-- Troy's two accounts are platform admins
update public.profiles set is_admin = true
 where id in (select id from auth.users
              where email in ('troy@reputationguardians.net','reputationanalyst@gmail.com'));

-- Fast admin check for server code
create or replace function public.is_admin(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin and status = 'active' from public.profiles where id = p_user), false);
$$;
revoke execute on function public.is_admin(uuid) from public, anon, authenticated;

-- Suspended accounts cannot start scans
create or replace function public.create_scan(
  p_teacher uuid, p_class_id uuid default null, p_student_id uuid default null,
  p_assessment_id uuid default null, p_upload_id uuid default null, p_billable boolean default true
) returns uuid language plpgsql volatile security definer set search_path = public as $$
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
  insert into public.scans (teacher_id, class_id, student_id, assessment_id, upload_id, billable, status)
  values (p_teacher, p_class_id, p_student_id, p_assessment_id, p_upload_id, p_billable, 'queued')
  returning id into v_id;
  return v_id;
end; $$;

-- ---------------------------------------------------------------
-- AUDIT LOG  (every admin action, forever)
-- ---------------------------------------------------------------
create table if not exists public.admin_audit_log (
  id          bigserial primary key,
  actor_id    uuid references auth.users(id) on delete set null,
  actor_email text,
  action      text        not null,
  target_type text,
  target_id   text,
  detail      jsonb,
  ip          text,
  created_at  timestamptz not null default now()
);
create index if not exists audit_created_idx on public.admin_audit_log (created_at desc);
create index if not exists audit_target_idx  on public.admin_audit_log (target_type, target_id);
alter table public.admin_audit_log enable row level security;  -- service role only

create or replace function public.admin_log(
  p_actor uuid, p_action text, p_target_type text default null,
  p_target_id text default null, p_detail jsonb default null, p_ip text default null
) returns bigint language plpgsql volatile security definer set search_path = public as $$
declare v_id bigint;
begin
  insert into public.admin_audit_log (actor_id, actor_email, action, target_type, target_id, detail, ip)
  select p_actor, u.email, p_action, p_target_type, p_target_id, p_detail, p_ip
    from auth.users u where u.id = p_actor
  returning id into v_id;
  return v_id;
end; $$;
revoke execute on function public.admin_log(uuid,text,text,text,jsonb,text) from public, anon, authenticated;

-- ---------------------------------------------------------------
-- ADMIN ACTIONS  (all audited, all service-role)
-- ---------------------------------------------------------------
create or replace function public.admin_set_plan(p_actor uuid, p_teacher uuid, p_plan text, p_reason text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_old text;
begin
  if not public.is_admin(p_actor) then raise exception 'NOT_ADMIN'; end if;
  select plan_id into v_old from public.subscriptions where teacher_id = p_teacher;
  update public.subscriptions set plan_id = p_plan, updated_at = now() where teacher_id = p_teacher;
  perform public.admin_log(p_actor, 'set_plan', 'teacher', p_teacher::text,
    jsonb_build_object('from', v_old, 'to', p_plan, 'reason', p_reason));
end; $$;

create or replace function public.admin_set_status(p_actor uuid, p_teacher uuid, p_status text, p_reason text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_old text;
begin
  if not public.is_admin(p_actor) then raise exception 'NOT_ADMIN'; end if;
  if p_teacher = p_actor and p_status <> 'active' then raise exception 'CANNOT_SUSPEND_SELF'; end if;
  select status into v_old from public.profiles where id = p_teacher;
  update public.profiles set status = p_status, status_reason = p_reason, updated_at = now() where id = p_teacher;
  perform public.admin_log(p_actor, 'set_status', 'teacher', p_teacher::text,
    jsonb_build_object('from', v_old, 'to', p_status, 'reason', p_reason));
end; $$;

create or replace function public.admin_set_admin(p_actor uuid, p_teacher uuid, p_is_admin boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_admin(p_actor) then raise exception 'NOT_ADMIN'; end if;
  if p_teacher = p_actor and not p_is_admin then raise exception 'CANNOT_DEMOTE_SELF'; end if;
  update public.profiles set is_admin = p_is_admin, updated_at = now() where id = p_teacher;
  perform public.admin_log(p_actor, case when p_is_admin then 'grant_admin' else 'revoke_admin' end,
    'teacher', p_teacher::text, null);
end; $$;

create or replace function public.admin_set_pipeline(p_actor uuid, p_stage text, p_model text,
  p_effort text, p_max_tokens int)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_old jsonb;
begin
  if not public.is_admin(p_actor) then raise exception 'NOT_ADMIN'; end if;
  select to_jsonb(c) into v_old from public.pipeline_config c where stage = p_stage;
  update public.pipeline_config set model = p_model, reasoning_effort = p_effort,
    max_output_tokens = p_max_tokens, updated_at = now() where stage = p_stage;
  perform public.admin_log(p_actor, 'set_pipeline', 'stage', p_stage,
    jsonb_build_object('from', v_old, 'to', jsonb_build_object('model', p_model, 'effort', p_effort, 'max', p_max_tokens)));
end; $$;

create or replace function public.admin_reset_teacher(p_actor uuid, p_teacher uuid, p_keep_scans boolean default true)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_admin(p_actor) then raise exception 'NOT_ADMIN'; end if;
  r := public.reset_teacher_data(p_teacher, p_keep_scans);
  perform public.admin_log(p_actor, 'reset_teacher_data', 'teacher', p_teacher::text, r);
  return r;
end; $$;

create or replace function public.admin_reply_ticket(p_actor uuid, p_ticket uuid, p_body text, p_status text default 'resolved')
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_teacher uuid;
begin
  if not public.is_admin(p_actor) then raise exception 'NOT_ADMIN'; end if;
  select teacher_id into v_teacher from public.support_tickets where id = p_ticket;
  insert into public.support_messages (ticket_id, teacher_id, author, body) values (p_ticket, v_teacher, 'staff', p_body);
  update public.support_tickets set status = p_status,
    resolved_at = case when p_status in ('resolved','closed') then now() end where id = p_ticket;
  perform public.admin_log(p_actor, 'reply_ticket', 'ticket', p_ticket::text, jsonb_build_object('status', p_status));
end; $$;

create or replace function public.admin_review_reteaching(p_actor uuid, p_id uuid, p_status text, p_quality numeric default null)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_admin(p_actor) then raise exception 'NOT_ADMIN'; end if;
  update public.reteaching_library set review_status = p_status,
    quality_score = coalesce(p_quality, quality_score), updated_at = now() where id = p_id;
  perform public.admin_log(p_actor, 'review_reteaching', 'reteaching', p_id::text,
    jsonb_build_object('status', p_status, 'quality', p_quality));
end; $$;

revoke execute on function public.admin_set_plan(uuid,uuid,text,text)             from public, anon, authenticated;
revoke execute on function public.admin_set_status(uuid,uuid,text,text)           from public, anon, authenticated;
revoke execute on function public.admin_set_admin(uuid,uuid,boolean)              from public, anon, authenticated;
revoke execute on function public.admin_set_pipeline(uuid,text,text,text,int)     from public, anon, authenticated;
revoke execute on function public.admin_reset_teacher(uuid,uuid,boolean)          from public, anon, authenticated;
revoke execute on function public.admin_reply_ticket(uuid,uuid,text,text)         from public, anon, authenticated;
revoke execute on function public.admin_review_reteaching(uuid,uuid,text,numeric) from public, anon, authenticated;
