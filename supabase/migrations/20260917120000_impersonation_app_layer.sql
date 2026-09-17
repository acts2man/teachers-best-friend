-- View As (impersonation) — app layer support.
--
-- The impersonation backend already existed (impersonation_sessions,
-- start/stop/resolve_impersonation) but nothing in the application ever called
-- it. Wiring it up surfaced three problems this migration fixes:
--
--   1. Only an app manager could impersonate, so admins who are not also app
--      managers were locked out of a feature the admin dashboard offers.
--   2. is_app_manager() ignored profiles.status, so a suspended app manager
--      could still start a session.
--   3. Nothing at the database level stopped a write from landing in the
--      impersonator's own workspace while a session was live.
--
-- Idempotent: safe to re-run.

-- 1. One predicate for "may start or continue a View As session".
--    Both admins and app managers qualify; suspended accounts never do.
create or replace function public.can_impersonate(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select (is_admin or is_app_manager) and status = 'active'
       from public.profiles where id = p_user),
    false);
$$;

revoke all on function public.can_impersonate(uuid) from public, anon, authenticated;
grant execute on function public.can_impersonate(uuid) to service_role;

-- 2. Route both ends of the session through the new predicate. These bodies are
--    the current live definitions with the permission check swapped; widening
--    only start_impersonation would mint sessions that resolve to null forever.
create or replace function public.start_impersonation(p_actor uuid, p_teacher uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_id uuid;
begin
  if not public.can_impersonate(p_actor) then raise exception 'NOT_APP_MANAGER'; end if;
  if p_teacher = p_actor then raise exception 'CANNOT_IMPERSONATE_SELF'; end if;
  insert into public.impersonation_sessions (app_manager_id, teacher_id, expires_at)
  values (p_actor, p_teacher, now() + interval '30 minutes')
  returning id into v_id;
  perform public.admin_log(p_actor, 'start_impersonation', 'teacher', p_teacher::text, null);
  return v_id;
end; $$;

create or replace function public.resolve_impersonation(p_session uuid, p_actor uuid)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select teacher_id from public.impersonation_sessions
   where id = p_session
     and app_manager_id = p_actor
     and ended_at is null
     and expires_at > now()
     and public.can_impersonate(p_actor);
$$;

-- 3. Only log a stop that actually closed a live session, so the audit trail
--    does not record stops for sessions that were already over.
create or replace function public.stop_impersonation(p_session uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_hit int;
begin
  update public.impersonation_sessions set ended_at = now()
   where id = p_session and app_manager_id = p_actor and ended_at is null;
  get diagnostics v_hit = row_count;
  if v_hit > 0 then
    perform public.admin_log(p_actor, 'stop_impersonation', 'session', p_session::text, null);
  end if;
end; $$;

-- 4. Close out sessions that hit their expiry without an explicit stop, so the
--    sessions list can show a real duration instead of an endless "Active".
create or replace function public.reap_impersonation_sessions()
returns integer
language sql
security definer
set search_path to 'public'
as $$
  with done as (
    update public.impersonation_sessions set ended_at = expires_at
     where ended_at is null and expires_at < now()
     returning 1)
  select count(*)::int from done;
$$;

revoke all on function public.reap_impersonation_sessions() from public, anon, authenticated;
grant execute on function public.reap_impersonation_sessions() to service_role;

-- 5. Database backstop. sync_workspace() ends in an upsert on teacher_workspaces
--    and runs as one transaction, so raising here rolls back the whole sync --
--    including its relational inserts and its destructive deletes. This catches
--    the corruption signature the application guard exists to prevent: writing
--    to an account's own workspace while that account has a live View As
--    session. The impersonator cannot save their own workspace until they stop.
create or replace function public.block_write_while_impersonating()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if exists (
    select 1 from public.impersonation_sessions s
     where s.app_manager_id = new.owner_id
       and s.ended_at is null
       and s.expires_at > now()
  ) then
    raise exception 'IMPERSONATION_ACTIVE';
  end if;
  return new;
end; $$;

drop trigger if exists trg_block_write_while_impersonating on public.teacher_workspaces;
create trigger trg_block_write_while_impersonating
  before insert or update on public.teacher_workspaces
  for each row execute function public.block_write_while_impersonating();

create index if not exists impersonation_sessions_live_idx
  on public.impersonation_sessions (app_manager_id) where ended_at is null;
