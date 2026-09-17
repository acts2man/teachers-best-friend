-- Only an existing app manager can grant/revoke the role, mirroring
-- admin_set_admin's posture. Service-role only, called from the admin UI.
create or replace function public.admin_set_app_manager(p_actor uuid, p_teacher uuid, p_value boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_app_manager(p_actor) then raise exception 'NOT_APP_MANAGER'; end if;
  update public.profiles set is_app_manager = p_value where id = p_teacher;
  perform public.admin_log(p_actor, 'set_app_manager', 'teacher', p_teacher::text, jsonb_build_object('to', p_value));
end; $$;
revoke execute on function public.admin_set_app_manager(uuid, uuid, boolean) from public, anon, authenticated;

