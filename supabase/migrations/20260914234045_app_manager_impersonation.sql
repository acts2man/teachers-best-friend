-- App manager: a tier above plain admin that can view any teacher's
-- workspace exactly as they see it, for support and debugging. This is
-- deliberately NOT admin-page access as that teacher -- /admin stays
-- gated on the real, authenticated identity everywhere. Only the
-- teacher-facing routes (workspace/scan/uploads/quota) resolve an active
-- impersonation session to the target teacher's id.
alter table public.profiles add column if not exists is_app_manager boolean not null default false;

create or replace function public.is_app_manager(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_app_manager from public.profiles where id = p_user), false);
$$;
revoke execute on function public.is_app_manager(uuid) from public, anon, authenticated;

-- Server-authoritative impersonation sessions. The client only ever holds
-- an opaque session id in a cookie -- nothing that could be forged into a
-- different teacher_id, and every session is time-boxed and revocable.
create table public.impersonation_sessions (
  id uuid primary key default gen_random_uuid(),
  app_manager_id uuid not null references auth.users(id) on delete cascade,
  teacher_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz
);
create index on public.impersonation_sessions (app_manager_id, expires_at);
alter table public.impersonation_sessions enable row level security;
-- No policies: service-role only, same posture as admin_audit_log.

create or replace function public.start_impersonation(p_actor uuid, p_teacher uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not public.is_app_manager(p_actor) then raise exception 'NOT_APP_MANAGER'; end if;
  if p_teacher = p_actor then raise exception 'CANNOT_IMPERSONATE_SELF'; end if;
  insert into public.impersonation_sessions (app_manager_id, teacher_id, expires_at)
  values (p_actor, p_teacher, now() + interval '30 minutes')
  returning id into v_id;
  perform public.admin_log(p_actor, 'start_impersonation', 'teacher', p_teacher::text, null);
  return v_id;
end; $$;
revoke execute on function public.start_impersonation(uuid, uuid) from public, anon, authenticated;

-- Re-validated on every teacher-facing request: session must belong to the
-- caller, be unexpired and unended, and the caller must still be an app
-- manager right now (a revoked app_manager's live sessions stop working
-- immediately, not just on next login).
create or replace function public.resolve_impersonation(p_session uuid, p_actor uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select teacher_id from public.impersonation_sessions
   where id = p_session and app_manager_id = p_actor and ended_at is null
     and expires_at > now() and public.is_app_manager(p_actor);
$$;
revoke execute on function public.resolve_impersonation(uuid, uuid) from public, anon, authenticated;

create or replace function public.stop_impersonation(p_session uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.impersonation_sessions set ended_at = now()
   where id = p_session and app_manager_id = p_actor and ended_at is null;
  perform public.admin_log(p_actor, 'stop_impersonation', 'session', p_session::text, null);
end; $$;
revoke execute on function public.stop_impersonation(uuid, uuid) from public, anon, authenticated;

-- Bootstrap: grant Troy's account app manager (nobody can self-grant this --
-- start_impersonation requires it already, so the very first one has to be
-- set directly, the same way the first admin account was).
update public.profiles set is_app_manager = true
where id = (select id from auth.users where email = 'troy@reputationguardians.net');

