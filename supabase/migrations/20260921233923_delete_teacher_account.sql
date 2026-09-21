-- "A teacher may delete any student, class, assessment, or their whole
-- account at any time from within the Service." -- content/legal/dpa.md,
-- Section 7. Three of those four were true.
--
-- DELETE /api/workspace emptied the classroom and deleted the uploads, and
-- stopped there: the auth user, the profile with their name and school, the
-- subscription, the scans, the support tickets and the messages in them all
-- stayed. There was no way, from inside the product, to be gone.
--
-- ---------------------------------------------------------------
-- The cost log has to outlive the account
-- ---------------------------------------------------------------
-- public.scans.teacher_id was NOT NULL and ON DELETE CASCADE, so deleting the
-- auth user took the financial record with it -- every cost_usd and token
-- count for work we had already paid OpenAI for. It is now nullable and SET
-- NULL, which is both what account deletion wants and the braces for the belt:
-- an auth user deleted by hand in the Supabase dashboard no longer erases the
-- month's costs as a side effect.
--
-- An unlinked scan row is not a record of a person. Its params, result and
-- error are cleared in the same breath (see purge_scan_payloads), so what
-- survives is a date, a model name, some token counts and a dollar amount.

alter table public.scans alter column teacher_id drop not null;
alter table public.scans drop constraint if exists scans_teacher_id_fkey;
alter table public.scans
  add constraint scans_teacher_id_fkey
  foreign key (teacher_id) references auth.users(id) on delete set null;

-- ---------------------------------------------------------------
-- The deletion itself
-- ---------------------------------------------------------------
-- Every teacher-owned table is deleted from EXPLICITLY here rather than left
-- to the cascade on auth.users. The cascade is real and would do it, but it
-- only fires if the auth admin API call succeeds, and that call is a network
-- request to a service we do not control. Making the disposal of a child's
-- work conditional on someone else's uptime is the wrong way round: this runs
-- first and on its own, and the auth user going away afterwards is what
-- finishes the job rather than what does it.
--
-- Every statement is an idempotent delete or update, and the audit entry is
-- guarded, so running this twice -- which is exactly what a resumed deletion
-- does -- changes nothing the second time.
--
-- p_actor is the admin acting on an LEA's behalf, or NULL when the teacher
-- deleted their own account. Either way no email and no name is written: the
-- row says an account on plan X was deleted at time T, and the id it names
-- resolves to nothing any more.
create or replace function public.delete_teacher_account(
  p_teacher uuid,
  p_actor   uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public', 'storage'
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

  -- The plan, before the subscription row goes. It is the one thing worth
  -- keeping about a closed account, and it is not personal.
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
  -- 2. Storage rows. The files themselves are removed through the Storage
  --    API by the caller before this runs -- Postgres cannot delete a file
  --    from a bucket, only forget it, and forgetting it would satisfy the
  --    audit trail while leaving the photograph on disk. These two statements
  --    are the tidy-up behind that, and the reason the route does its half
  --    first.
  -- ---------------------------------------------------------------
  delete from storage.objects o
   using public.uploads u
   where u.teacher_id = p_teacher
     and o.bucket_id = u.bucket_id
     and o.name = u.object_path;
  get diagnostics v_files = row_count;

  delete from public.uploads         where teacher_id = p_teacher;
  delete from public.teacher_uploads where owner_id   = p_teacher;

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
  -- Support threads are a teacher's own words, often with a student's work
  -- described in them. They are not an admin action log.
  delete from public.support_messages      where teacher_id = p_teacher;
  delete from public.support_tickets       where teacher_id = p_teacher;
  delete from public.impersonation_sessions where teacher_id = p_teacher;
  delete from public.subscriptions         where teacher_id = p_teacher;
  delete from public.profiles              where id         = p_teacher;

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
    'storage_rows_removed', v_files,
    'account_existed', v_existed
  );
end;
$$;

comment on function public.delete_teacher_account(uuid, uuid) is
  'Deletes everything one teacher owns, unlinks their scans so the cost log survives with no student content and no link to them, and writes one audit line carrying no email and no name. Idempotent: a resumed deletion re-runs it safely. The auth user is deleted by the caller afterwards.';

-- The admin door, for an LEA request under DPA Section 7. Same function, plus
-- the admin check the rest of admin_* uses, and the admin's id on the audit
-- line instead of a NULL.
create or replace function public.admin_delete_teacher_account(
  p_actor uuid,
  p_teacher uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.is_admin(p_actor) then raise exception 'NOT_ADMIN'; end if;
  if p_actor = p_teacher then
    -- An admin deleting themselves through the admin page would revoke the
    -- ability to finish the job halfway through it.
    raise exception 'CANNOT_DELETE_SELF_FROM_ADMIN';
  end if;
  return public.delete_teacher_account(p_teacher, p_actor);
end;
$$;

revoke execute on function public.delete_teacher_account(uuid, uuid)       from public, anon, authenticated;
revoke execute on function public.admin_delete_teacher_account(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.delete_teacher_account(uuid, uuid)       to service_role;
grant  execute on function public.admin_delete_teacher_account(uuid, uuid) to service_role;
