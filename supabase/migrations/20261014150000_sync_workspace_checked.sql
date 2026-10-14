set lock_timeout = '5s';

-- NOT applied by the author. Apply by hand before merging the PR that adds it
-- (supabase/migrations/README.md); until then the app falls back to the old
-- path (PGRST202) and logs that it did.

-- Gap G4 (docs/system-map.md, rule R7): a save checked the workspace revision
-- and then called sync_workspace in a SECOND round trip. Two saves carrying
-- the same current revision that arrived together could both pass the check;
-- the second whole-workspace replace then deleted whatever the first added
-- (sync_workspace deletes every row it is not sent -- rule R1).
--
-- sync_workspace_checked does both in one transaction: it locks the
-- teacher's teacher_workspaces row, compares the revision the browser loaded,
-- and only then runs sync_workspace (which bumps the revision on that same
-- row). A second save arriving together waits on the lock, then sees the
-- bumped revision and is refused. Returns the new revision, or null when the
-- save is stale (or the workspace does not exist: a save never creates one).
--
-- sync_workspace itself is not changed. New function only: nothing to drop,
-- nothing to re-create (rule R9).

create or replace function public.sync_workspace_checked(
  p_teacher uuid,
  p_data jsonb,
  p_expected_revision integer
)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  current_revision integer;
begin
  select revision into current_revision
    from public.teacher_workspaces
   where owner_id = p_teacher
   for update;
  if current_revision is null or current_revision <> p_expected_revision then
    return null;
  end if;
  perform public.sync_workspace(p_teacher, p_data);
  select revision into current_revision
    from public.teacher_workspaces
   where owner_id = p_teacher;
  return current_revision;
end;
$function$;

-- The other writers (a reset, the first save) go through this, so EVERY write
-- takes the teacher_workspaces row lock first and the child tables after. A
-- plain sync_workspace takes them the other way round (it upserts the row
-- last), and a reset racing a checked save deadlocked (review of the G4 PR).
create or replace function public.sync_workspace_locked(p_teacher uuid, p_data jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform 1 from public.teacher_workspaces where owner_id = p_teacher for update;
  return public.sync_workspace(p_teacher, p_data);
end;
$function$;

-- The server's service role only, granted explicitly rather than left to the
-- default privileges of whoever applies this.
revoke execute on function public.sync_workspace_checked(uuid, jsonb, integer) from public, anon, authenticated;
revoke execute on function public.sync_workspace_locked(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sync_workspace_checked(uuid, jsonb, integer) to service_role;
grant execute on function public.sync_workspace_locked(uuid, jsonb) to service_role;
