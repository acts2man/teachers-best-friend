-- Gap G4 (docs/system-map.md, rule R7): the revision check on a workspace save
-- was not atomic. updateWorkspace (lib/teacher-server.ts) read
-- teacher_workspaces.revision, compared it with the revision the browser tab
-- loaded, and then called sync_workspace in a SEPARATE round trip. Two saves
-- carrying the same current revision that arrived together both passed the
-- check; the second whole-workspace replace (rule R1) then deleted whatever
-- the first had added.
--
-- The fix: sync_workspace_if_revision(p_teacher, p_data, p_expected_revision)
-- does the check and the write in ONE transaction. It locks the teacher's
-- teacher_workspaces row (select ... for update), compares the stored revision
-- with the expected one, and only then calls the existing
-- sync_workspace(p_teacher, p_data), which bumps the revision as it always has.
-- A second save carrying the same revision waits on the row lock; when the
-- first commits, the second re-reads the row, sees revision N+1 and is refused.
--
-- A refused save RETURNS NULL -- it does not raise, so it never becomes a 500;
-- the app maps null to the route's existing 409. A teacher with no
-- teacher_workspaces row is refused too (null): a revision-checked save never
-- creates a workspace, the same as before. Otherwise it returns the new
-- revision.
--
-- How: a thin NEW wrapper, not a new parameter on sync_workspace. A parameter
-- would change the signature, which in Postgres is a different function -- it
-- would mean restating the ~19,000-character body (rule R9 forbids that: a
-- whole-body redefinition written against an old copy reverts other people's
-- patches) or leaving two overloads of sync_workspace for the patch migrations
-- to tell apart. The wrapper does not touch sync_workspace at all, so every
-- patch to it, before or after this file, still applies, and
-- initializeWorkspace / replaceWorkspace keep calling the 2-argument form.
--
-- Grants: like sync_workspace (20260909214420_tbf_23_sync_workspace.sql), it is
-- revoked from public, anon and authenticated -- it is SECURITY DEFINER and
-- takes any teacher id, so only the service role (the server) may call it.
--
-- Deploy order: apply before or after the code ships -- the code tolerates
-- both. Until this is applied, updateWorkspace gets PostgREST's "function
-- does not exist" (PGRST202), logs it with console.error on EVERY save, and
-- falls back to the old non-atomic check-then-write, so saves keep working
-- with gap G4 still open. Once applied, every save takes the atomic path, and
-- the fallback in lib/teacher-server.ts should be removed.
--
-- Lock order: this function locks teacher_workspaces FIRST; a direct
-- sync_workspace call writes the child tables first and that row LAST. Run
-- together for one teacher, the two can deadlock (Postgres aborts one). The
-- app's reset (replaceWorkspace) therefore goes through this function too.
-- Still direct: initializeWorkspace (first load, no row yet) and the SQL
-- reset_teacher_data().
--
-- NOT applied by the author -- apply by hand. Proof:
-- supabase/checks/atomic-revision-round-trip.sql, run by hand AFTER this file;
-- it rolls itself back.

set lock_timeout = '5s';

create or replace function public.sync_workspace_if_revision(
  p_teacher uuid,
  p_data jsonb,
  p_expected_revision bigint
)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  current_revision bigint;
begin
  -- The lock is the point: a concurrent save for the same teacher waits here
  -- until this transaction ends, then reads the revision this one wrote.
  select w.revision into current_revision
    from public.teacher_workspaces w
   where w.owner_id = p_teacher
     for update;

  if not found or p_expected_revision is null
     or current_revision is distinct from p_expected_revision then
    return null; -- stale (or no workspace): nothing is written
  end if;

  perform public.sync_workspace(p_teacher, p_data);

  select w.revision into current_revision
    from public.teacher_workspaces w
   where w.owner_id = p_teacher;
  return current_revision;
end;
$function$;

revoke execute on function public.sync_workspace_if_revision(uuid, jsonb, bigint) from public, anon, authenticated;
grant execute on function public.sync_workspace_if_revision(uuid, jsonb, bigint) to service_role;
