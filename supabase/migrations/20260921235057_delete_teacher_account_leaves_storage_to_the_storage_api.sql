-- delete_teacher_account could never have run.
--
-- It carried a `delete from storage.objects` as a tidy-up behind the Storage
-- API call the route makes. storage.objects has a trigger on it,
-- protect_objects_delete -> storage.protect_delete(), which raises 42501
-- "Direct deletion from storage tables is not allowed. Use the Storage API
-- instead." on any such statement. Not a permission that can be granted: a
-- trigger, raising unconditionally.
--
-- So the statement did not quietly do nothing. It aborted the whole function,
-- every time, and account deletion would have failed for every teacher who had
-- ever uploaded anything -- which is all of them. It was caught by
-- supabase/checks/account-deletion.sql on its first run against production,
-- before any of this reached a teacher.
--
-- docs/student-data-flow.md says this, in the section explaining why the
-- nightly purge is an edge function rather than SQL: "Postgres blocks direct
-- DELETE against storage.objects." The document was right and the function
-- was written anyway.
--
-- The fix is not to find a way around the trigger. The trigger is correct:
-- removing the row without removing the file is how you end up with a bucket
-- full of children's work that nothing points at any more, and an audit trail
-- that says it was deleted. The files are removed through the Storage API by
-- purgeTeacherDocuments() in lib/account-deletion-server.ts before this runs,
-- for both teacher_uploads and the legacy uploads table. This function deletes
-- the rows and leaves storage alone.
--
-- Everything else is unchanged from 20260921233923.
--
-- Worth knowing: public.reset_teacher_data() has the same statement and the
-- same problem, so the admin "Reset this account's data" button raises today.
-- Left alone here rather than fixed in passing -- it is a different button
-- with a different job, and it deserves its own change and its own proof.

create or replace function public.delete_teacher_account(
  p_teacher uuid,
  p_actor   uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_plan    text;
  v_scans   int := 0;
  v_files   int := 0;
  v_existed boolean;
begin
  if p_teacher is null then
    raise exception 'DELETE_TEACHER_ACCOUNT: no teacher id';
  end if;

  select exists (select 1 from auth.users where id = p_teacher) into v_existed;

  select sub.plan_id into v_plan
    from public.subscriptions sub where sub.teacher_id = p_teacher;

  -- ---------------------------------------------------------------
  -- 1. The cost log survives, unlinked and emptied of student work.
  -- ---------------------------------------------------------------
  update public.scans
     set params = null, result = null, error = null, teacher_id = null
   where teacher_id = p_teacher;
  get diagnostics v_scans = row_count;

  -- page_charges is a ledger of page hashes, and a SHA-256 of a child's page
  -- is derived from a child's page. It exists to stop the same page being
  -- charged twice inside one account; with the account gone there is no
  -- second charge to prevent, so it goes rather than lingering as a hash of
  -- work we promised to delete. The money it represents is already in
  -- scans.cost_usd.
  delete from public.page_charges where teacher_id = p_teacher;

  -- ---------------------------------------------------------------
  -- 2. Upload rows only. The files themselves are already gone, removed
  --    through the Storage API by the caller -- which is the only way they
  --    can be removed, and the reason this function does not try.
  -- ---------------------------------------------------------------
  delete from public.uploads where teacher_id = p_teacher;
  get diagnostics v_files = row_count;
  delete from public.teacher_uploads where owner_id = p_teacher;

  -- ---------------------------------------------------------------
  -- 3. Everything a student is in. Child rows before parents, so this holds
  --    even where a foreign key is RESTRICT rather than CASCADE.
  -- ---------------------------------------------------------------
  delete from public.student_evidence      where teacher_id = p_teacher;
  delete from public.student_responses     where teacher_id = p_teacher;
  delete from public.assessment_questions  where teacher_id = p_teacher;
  delete from public.assessment_standards  where teacher_id = p_teacher;
  delete from public.assessments           where teacher_id = p_teacher;
  delete from public.student_group_members where teacher_id = p_teacher;
  delete from public.student_groups        where teacher_id = p_teacher;
  delete from public.students              where teacher_id = p_teacher;
  delete from public.lessons               where teacher_id = p_teacher;
  delete from public.resources             where teacher_id = p_teacher;
  delete from public.classes               where teacher_id = p_teacher;
  -- Only this teacher's own custom standards. The shared library rows carry
  -- teacher_id NULL and are not theirs to take with them.
  delete from public.standards             where teacher_id = p_teacher;
  delete from public.teacher_workspaces    where owner_id   = p_teacher;

  -- ---------------------------------------------------------------
  -- 4. The account itself.
  -- ---------------------------------------------------------------
  delete from public.support_messages       where teacher_id = p_teacher;
  delete from public.support_tickets        where teacher_id = p_teacher;
  delete from public.impersonation_sessions where teacher_id = p_teacher;
  delete from public.subscriptions          where teacher_id = p_teacher;
  delete from public.profiles               where id         = p_teacher;

  -- ---------------------------------------------------------------
  -- 5. One line in the audit log, guarded so a resumed run does not write a
  --    second one. actor_email stays NULL on purpose: for a self-serve
  --    deletion the actor IS the person being deleted, and writing their
  --    address into the record of their deletion would be an odd way to
  --    honour it. An admin is identified by actor_id.
  -- ---------------------------------------------------------------
  if not exists (
    select 1 from public.admin_audit_log
     where action = 'delete_account'
       and target_type = 'teacher'
       and target_id = p_teacher::text
  ) then
    insert into public.admin_audit_log (actor_id, actor_email, action, target_type, target_id, detail)
    values (
      p_actor, null, 'delete_account', 'teacher', p_teacher::text,
      jsonb_build_object(
        'plan', v_plan,
        'self_serve', p_actor is null,
        'scans_unlinked', v_scans,
        'account_existed', v_existed
      )
    );
  end if;

  return jsonb_build_object(
    'teacher', p_teacher,
    'plan', v_plan,
    'scans_unlinked', v_scans,
    'upload_rows_removed', v_files,
    'account_existed', v_existed
  );
end;
$$;

comment on function public.delete_teacher_account(uuid, uuid) is
  'Deletes everything one teacher owns, unlinks their scans so the cost log survives with no student content and no link to them, and writes one audit line carrying no email and no name. Idempotent: a resumed deletion re-runs it safely. Storage files are removed through the Storage API by the caller before this runs; the auth user is deleted by the caller after.';

revoke execute on function public.delete_teacher_account(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.delete_teacher_account(uuid, uuid) to service_role;
