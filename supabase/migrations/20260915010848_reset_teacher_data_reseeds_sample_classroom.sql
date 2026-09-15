-- Audit fix, part 3: an admin reset left the account unloadable.
--
-- reset_teacher_data() deleted every class and then wrote a blob with
-- 'classes': [] and 'activeClassId': null. Because the teacher_workspaces
-- row still existed, readWorkspace() in lib/teacher-server.ts returned it
-- instead of calling initializeWorkspace(), so the teacher received a
-- workspace with zero classes. components/teacher-app.tsx then does
--
--   const classroom = w.classes.find(...) || w.classes[0]   // undefined
--   ... students = w.students.filter(s => s.classId === classroom.id)
--
-- which throws on the next line: a blank screen with no way back, on an
-- account an admin had just "fixed".
--
-- Reset now re-seeds the sample classroom from public.demo_templates (the
-- 24-student "The Explorers" row that was already there and that nothing
-- read) by replaying it through sync_workspace, so a reset account lands
-- exactly where a new signup does. The teacher's own settings are still
-- preserved across the wipe.

create or replace function public.reset_teacher_data(p_teacher uuid, p_keep_scans boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'storage'
as $function$
declare
  v_settings jsonb;
  v_files int := 0;
  v_before jsonb;
  v_template jsonb;
  v_seeded jsonb := null;
begin
  select jsonb_build_object(
    'students',    (select count(*) from public.students    where teacher_id = p_teacher),
    'assessments', (select count(*) from public.assessments where teacher_id = p_teacher),
    'responses',   (select count(*) from public.student_responses where teacher_id = p_teacher)
  ) into v_before;

  -- keep the teacher's own settings out of the wipe
  select coalesce(data -> 'settings', '{}'::jsonb) into v_settings
    from public.teacher_workspaces where owner_id = p_teacher;

  -- storage objects first, then their rows
  delete from storage.objects o
   using public.uploads u
   where u.teacher_id = p_teacher
     and o.bucket_id = u.bucket_id
     and o.name = u.object_path;
  get diagnostics v_files = row_count;

  delete from public.uploads where teacher_id = p_teacher;

  -- content (FKs cascade responses/questions/members)
  delete from public.student_evidence  where teacher_id = p_teacher;
  delete from public.student_responses where teacher_id = p_teacher;
  delete from public.assessment_questions where teacher_id = p_teacher;
  delete from public.assessments       where teacher_id = p_teacher;
  delete from public.student_group_members where teacher_id = p_teacher;
  delete from public.student_groups    where teacher_id = p_teacher;
  delete from public.students          where teacher_id = p_teacher;
  delete from public.lessons           where teacher_id = p_teacher;
  delete from public.resources         where teacher_id = p_teacher;
  delete from public.classes           where teacher_id = p_teacher;
  delete from public.standards         where teacher_id = p_teacher;  -- custom only; globals are NULL

  if not p_keep_scans then
    delete from public.scans where teacher_id = p_teacher;
  end if;

  -- Re-seed the sample classroom, keeping the teacher's settings. A workspace
  -- with no classes cannot be rendered, so this is not cosmetic.
  select data into v_template
    from public.demo_templates where active order by created_at limit 1;

  if v_template is not null then
    v_seeded := public.sync_workspace(
      p_teacher,
      v_template || jsonb_build_object('settings', v_settings)
    );
  else
    -- No template configured: leave a valid, empty blob rather than a broken one.
    update public.teacher_workspaces
       set data = jsonb_build_object(
             'activeClassId', null, 'settings', v_settings),
           revision = revision + 1
     where owner_id = p_teacher;
  end if;

  return jsonb_build_object(
    'teacher', p_teacher, 'cleared', v_before,
    'files_deleted', v_files, 'settings_preserved', v_settings,
    'scans_kept', p_keep_scans, 'reseeded', v_seeded);
end;
$function$;

