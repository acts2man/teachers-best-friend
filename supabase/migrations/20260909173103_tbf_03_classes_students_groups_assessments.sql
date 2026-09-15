-- ---------------------------------------------------------------
-- CLASSES
-- ---------------------------------------------------------------
create table if not exists public.classes (
  id           uuid primary key default gen_random_uuid(),
  teacher_id   uuid        not null references auth.users(id) on delete cascade,
  name         text        not null check (char_length(name) between 1 and 120),
  subject      text,
  grade        text,
  period       text,
  school_year  text,
  color        text,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists classes_teacher_idx on public.classes (teacher_id) where archived_at is null;

-- ---------------------------------------------------------------
-- STUDENTS
--
-- PRIVACY BY DEFAULT.
-- display_label is what the app shows and is REQUIRED — teachers should
-- use initials or a roster number. full_name is OPTIONAL and nullable;
-- the product must work fully without it. Under California SOPIPA
-- (Ed. Code 22584) this operator is directly regulated regardless of
-- whether a district contract exists, so the less student PII stored,
-- the smaller the compliance and breach surface.
--
-- `notes` is free-text a teacher writes about a child. It is nullable,
-- retention-bounded, and should never be sent to a model or included in
-- any export without explicit consent.
-- ---------------------------------------------------------------
create table if not exists public.students (
  id             uuid primary key default gen_random_uuid(),
  teacher_id     uuid        not null references auth.users(id) on delete cascade,
  class_id       uuid        references public.classes(id) on delete set null,
  display_label  text        not null check (char_length(display_label) between 1 and 60),
  full_name      text,
  external_ref   text,
  color          text,
  notes          text,
  notes_expire_at timestamptz,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on column public.students.full_name is
  'OPTIONAL. Nullable by design — never make this required. See SOPIPA note on table.';
comment on column public.students.notes is
  'Teacher free-text about a student. Never send to an LLM. Purged via notes_expire_at.';

create index if not exists students_teacher_idx on public.students (teacher_id) where archived_at is null;
create index if not exists students_class_idx   on public.students (class_id)   where archived_at is null;

-- ---------------------------------------------------------------
-- GROUPS  (small groups / intervention groupings)
-- ---------------------------------------------------------------
create table if not exists public.student_groups (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid        not null references auth.users(id) on delete cascade,
  class_id    uuid        references public.classes(id) on delete cascade,
  name        text        not null,
  purpose     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.student_group_members (
  group_id    uuid not null references public.student_groups(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  teacher_id  uuid not null references auth.users(id) on delete cascade,
  added_at    timestamptz not null default now(),
  primary key (group_id, student_id)
);

create index if not exists group_members_student_idx on public.student_group_members (student_id);

-- ---------------------------------------------------------------
-- ASSESSMENTS  (the worksheet / assignment being scanned)
-- ---------------------------------------------------------------
create table if not exists public.assessments (
  id            uuid primary key default gen_random_uuid(),
  teacher_id    uuid        not null references auth.users(id) on delete cascade,
  class_id      uuid        references public.classes(id) on delete set null,
  title         text        not null check (char_length(title) between 1 and 200),
  subject       text,
  grade         text,
  assigned_on   date,
  answer_key    jsonb,
  item_count    integer,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists assessments_teacher_idx on public.assessments (teacher_id) where archived_at is null;

-- Standards an assessment covers
create table if not exists public.assessment_standards (
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  standard_id   uuid not null references public.standards(id)   on delete cascade,
  teacher_id    uuid not null references auth.users(id)         on delete cascade,
  primary key (assessment_id, standard_id)
);

-- ---------------------------------------------------------------
-- LESSONS / RESOURCES
-- ---------------------------------------------------------------
create table if not exists public.lessons (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid        not null references auth.users(id) on delete cascade,
  class_id    uuid        references public.classes(id) on delete set null,
  title       text        not null,
  body        jsonb,
  scheduled_for date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.resources (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid        not null references auth.users(id) on delete cascade,
  title       text        not null,
  kind        text,
  url         text,
  body        jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger classes_touch     before update on public.classes     for each row execute function public.touch_updated_at();
create trigger students_touch    before update on public.students    for each row execute function public.touch_updated_at();
create trigger groups_touch      before update on public.student_groups for each row execute function public.touch_updated_at();
create trigger assessments_touch before update on public.assessments for each row execute function public.touch_updated_at();
create trigger lessons_touch     before update on public.lessons     for each row execute function public.touch_updated_at();
create trigger resources_touch   before update on public.resources   for each row execute function public.touch_updated_at();
