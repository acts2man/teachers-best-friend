-- Columns the blob carries that the relational model didn't have a home for.
-- Kept as jsonb where they are pure client-side bookkeeping (upload id lists,
-- target standard codes) rather than inventing join tables for legacy ids.
alter table public.assessments add column if not exists class_ids        text[] not null default '{}';
alter table public.assessments add column if not exists target_standards text[] not null default '{}';
alter table public.assessments add column if not exists upload_refs      jsonb  not null default '{}'::jsonb;
comment on column public.assessments.upload_refs is
  'Legacy upload-id lists from the client: {uploadIds, assignmentUploadIds, answerKeyUploadIds, studentUploadIds}.';

alter table public.students add column if not exists legacy_class_id text;
alter table public.lessons  add column if not exists body jsonb;
alter table public.student_groups add column if not exists standard_code text;

-- Client-generated ids are the stable key across the facade.
-- Every row the app can address needs one.
create unique index if not exists evidence_legacy_key
  on public.student_evidence (teacher_id, legacy_id) where legacy_id is not null;
create unique index if not exists responses_legacy_key
  on public.student_responses (teacher_id, legacy_id) where legacy_id is not null;
create unique index if not exists custom_standards_key
  on public.standards (teacher_id, code) where teacher_id is not null;
