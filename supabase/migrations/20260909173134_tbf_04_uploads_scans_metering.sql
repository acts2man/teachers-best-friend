-- ---------------------------------------------------------------
-- UPLOADS
-- Worksheet images are transient. Process, extract, purge.
-- Storing them forever is both a cost problem (egress at $0.09/GB)
-- and a student-privacy problem.
-- ---------------------------------------------------------------
create table if not exists public.uploads (
  id             uuid primary key default gen_random_uuid(),
  teacher_id     uuid        not null references auth.users(id) on delete cascade,
  bucket_id      text        not null default 'teacher-documents',
  object_path    text        not null unique,
  original_name  text        not null check (char_length(original_name) between 1 and 180),
  mime           text        not null
                   check (mime in ('application/pdf','image/jpeg','image/png','image/webp')),
  size_bytes     integer     not null check (size_bytes > 0 and size_bytes <= 8388608),
  purpose        text        not null default 'scan',
  processed_at   timestamptz,
  expires_at     timestamptz not null default (now() + interval '30 days'),
  purged_at      timestamptz,
  created_at     timestamptz not null default now()
);

comment on table public.uploads is
  'Transient worksheet images. expires_at drives purge_expired_uploads().
   Nothing here should be treated as a permanent record.';

create index if not exists uploads_teacher_idx on public.uploads (teacher_id);
create index if not exists uploads_purge_idx   on public.uploads (expires_at) where purged_at is null;

-- ---------------------------------------------------------------
-- SCANS  ***THE BILLING METER***
--
-- One row per worksheet processed. This table is what makes metered
-- pricing possible: quota enforcement counts rows, and cost_usd gives
-- true per-teacher COGS instead of a guess.
-- ---------------------------------------------------------------
do $$ begin
  create type public.scan_status as enum ('queued','extracting','analyzing','complete','failed','canceled');
exception when duplicate_object then null; end $$;

create table if not exists public.scans (
  id             uuid primary key default gen_random_uuid(),
  teacher_id     uuid        not null references auth.users(id)       on delete cascade,
  class_id       uuid        references public.classes(id)            on delete set null,
  student_id     uuid        references public.students(id)           on delete set null,
  assessment_id  uuid        references public.assessments(id)        on delete set null,
  upload_id      uuid        references public.uploads(id)            on delete set null,

  status         public.scan_status not null default 'queued',
  error          text,

  -- billing
  billable       boolean     not null default true,
  billing_period date        not null default date_trunc('month', now())::date,

  -- cost telemetry (stage 1: cheap extraction)
  extract_model               text,
  extract_input_tokens        integer not null default 0,
  extract_cached_input_tokens integer not null default 0,
  extract_output_tokens       integer not null default 0,

  -- cost telemetry (stage 2: reteaching generation, only on misses)
  reteach_model               text,
  reteach_input_tokens        integer not null default 0,
  reteach_cached_input_tokens integer not null default 0,
  reteach_output_tokens       integer not null default 0,

  -- library cache effectiveness
  library_hits   integer     not null default 0,
  library_misses integer     not null default 0,

  cost_usd       numeric(10,6) not null default 0,

  created_at     timestamptz not null default now(),
  completed_at   timestamptz
);

comment on table public.scans is
  'One row per worksheet scan. Quota enforcement counts these rows;
   cost_usd is real COGS per teacher. Never batch multiple worksheets
   into one row — the row IS the billable unit.';

create index if not exists scans_meter_idx
  on public.scans (teacher_id, billing_period) where billable;
create index if not exists scans_teacher_recent_idx on public.scans (teacher_id, created_at desc);
create index if not exists scans_student_idx        on public.scans (student_id);
create index if not exists scans_assessment_idx     on public.scans (assessment_id);
create index if not exists scans_status_idx         on public.scans (status) where status in ('queued','extracting','analyzing');

-- ---------------------------------------------------------------
-- SCAN ITEMS  (per-question results)
-- ---------------------------------------------------------------
create table if not exists public.scan_items (
  id                 uuid primary key default gen_random_uuid(),
  scan_id            uuid        not null references public.scans(id) on delete cascade,
  teacher_id         uuid        not null references auth.users(id)   on delete cascade,
  item_number        integer,
  prompt_text        text,
  student_response   text,
  is_correct         boolean,
  standard_id        uuid        references public.standards(id)          on delete set null,
  error_pattern_key  text,
  reteaching_id      uuid        references public.reteaching_library(id) on delete set null,
  served_from_cache  boolean     not null default false,
  confidence         numeric(4,3) check (confidence between 0 and 1),
  created_at         timestamptz not null default now()
);

create index if not exists scan_items_scan_idx     on public.scan_items (scan_id);
create index if not exists scan_items_teacher_idx  on public.scan_items (teacher_id);
create index if not exists scan_items_standard_idx on public.scan_items (standard_id) where is_correct = false;

-- ---------------------------------------------------------------
-- QUOTA HELPERS
-- ---------------------------------------------------------------
create or replace function public.current_period_scan_count(p_teacher uuid default auth.uid())
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
    from public.scans s
    join public.subscriptions sub on sub.teacher_id = s.teacher_id
   where s.teacher_id  = p_teacher
     and s.billable
     and s.status <> 'failed'
     and s.created_at >= sub.current_period_start
     and s.created_at <  sub.current_period_end;
$$;

create or replace function public.scan_quota_status(p_teacher uuid default auth.uid())
returns table (plan_id text, quota integer, used integer, remaining integer, can_scan boolean)
language sql
stable
security definer
set search_path = public
as $$
  select p.id,
         p.scan_quota,
         public.current_period_scan_count(p_teacher),
         greatest(p.scan_quota - public.current_period_scan_count(p_teacher), 0),
         public.current_period_scan_count(p_teacher) < p.scan_quota
    from public.subscriptions sub
    join public.plans p on p.id = sub.plan_id
   where sub.teacher_id = p_teacher;
$$;

-- ---------------------------------------------------------------
-- PURGE JOB  (call from a scheduled edge function)
-- ---------------------------------------------------------------
create or replace function public.purge_expired_uploads()
returns integer
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  purged integer;
begin
  with due as (
    select id, bucket_id, object_path
      from public.uploads
     where purged_at is null
       and expires_at <= now()
     limit 500
  ), gone as (
    delete from storage.objects o
     using due
     where o.bucket_id = due.bucket_id and o.name = due.object_path
    returning o.name
  )
  update public.uploads u
     set purged_at = now()
    from due
   where u.id = due.id;

  get diagnostics purged = row_count;
  return purged;
end;
$$;

-- Purge expired student notes
create or replace function public.purge_expired_student_notes()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  update public.students
     set notes = null, notes_expire_at = null
   where notes is not null
     and notes_expire_at is not null
     and notes_expire_at <= now();
  get diagnostics n = row_count;
  return n;
end;
$$;
