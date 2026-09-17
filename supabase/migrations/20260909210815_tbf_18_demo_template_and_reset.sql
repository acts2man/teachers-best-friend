-- ---------------------------------------------------------------
-- DEMO TEMPLATES
-- The seeded classroom, kept as a reusable onboarding fixture rather
-- than sitting inside a real teacher's account.
-- ---------------------------------------------------------------
create table if not exists public.demo_templates (
  id          text primary key,
  label       text        not null,
  description text,
  data        jsonb       not null,
  active      boolean     not null default true,
  created_at  timestamptz not null default now()
);

alter table public.demo_templates enable row level security;
create policy demo_templates_read on public.demo_templates
  for select to authenticated using (active);

-- Snapshot the richest existing workspace as the canonical demo
insert into public.demo_templates (id, label, description, data)
select 'ca-grade-4',
       'California Grade 4 sample classroom',
       'Seeded demo: 24 students, sample assessments with questions and responses. Loaded on request for new teachers who want to see the product with data in it.',
       w.data
from public.teacher_workspaces w
order by jsonb_array_length(w.data -> 'assessments') desc
limit 1
on conflict (id) do nothing;

-- ---------------------------------------------------------------
-- RESET A TEACHER TO A CLEAN SLATE
-- Clears relational rows, uploaded files, and the legacy blob, while
-- PRESERVING the teacher's settings (name, school, theme) and their
-- profile and subscription. Scans are kept unless p_keep_scans=false,
-- because they are billing history, not content.
-- ---------------------------------------------------------------
create or replace function public.reset_teacher_data(
  p_teacher    uuid,
  p_keep_scans boolean default true
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, storage
as $$
declare
  v_settings jsonb;
  v_files int := 0;
  v_before jsonb;
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

  -- reset the legacy blob to a valid empty workspace, settings intact
  update public.teacher_workspaces
     set data = jsonb_build_object(
           'classes', '[]'::jsonb, 'students', '[]'::jsonb,
           'assessments', '[]'::jsonb, 'lessons', '[]'::jsonb,
           'groups', '[]'::jsonb, 'resources', '[]'::jsonb,
           'customStandards', '[]'::jsonb,
           'activeClassId', null,
           'settings', v_settings),
         revision = revision + 1
   where owner_id = p_teacher;

  return jsonb_build_object(
    'teacher', p_teacher, 'cleared', v_before,
    'files_deleted', v_files, 'settings_preserved', v_settings,
    'scans_kept', p_keep_scans);
end;
$$;

revoke execute on function public.reset_teacher_data(uuid, boolean) from public, anon, authenticated;
