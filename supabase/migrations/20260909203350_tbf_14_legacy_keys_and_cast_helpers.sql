alter table public.classes   add column if not exists legacy_id text;
alter table public.classes   add column if not exists framework text;
alter table public.classes   add column if not exists is_demo boolean not null default false;
alter table public.students  add column if not exists legacy_id text;
alter table public.lessons   add column if not exists legacy_id text;
alter table public.resources add column if not exists legacy_id text;
alter table public.student_groups add column if not exists legacy_id text;

create unique index if not exists classes_legacy_key
  on public.classes (teacher_id, legacy_id) where legacy_id is not null;
create unique index if not exists students_legacy_key
  on public.students (teacher_id, legacy_id) where legacy_id is not null;
create unique index if not exists assessments_legacy_key
  on public.assessments (teacher_id, legacy_id) where legacy_id is not null;
create unique index if not exists lessons_legacy_key
  on public.lessons (teacher_id, legacy_id) where legacy_id is not null;
create unique index if not exists resources_legacy_key
  on public.resources (teacher_id, legacy_id) where legacy_id is not null;
create unique index if not exists groups_legacy_key
  on public.student_groups (teacher_id, legacy_id) where legacy_id is not null;

-- Prototype JSON is not type-safe. Never let one bad value abort a migration.
create or replace function public.safe_numeric(t text)
returns numeric language plpgsql immutable as $$
begin return t::numeric; exception when others then return null; end; $$;

create or replace function public.safe_int(t text)
returns integer language plpgsql immutable as $$
begin return t::integer; exception when others then return null; end; $$;

create or replace function public.safe_bool(t text, d boolean default false)
returns boolean language plpgsql immutable as $$
begin return coalesce(t::boolean, d); exception when others then return d; end; $$;

create or replace function public.safe_date(t text)
returns date language plpgsql immutable as $$
begin return t::date; exception when others then return null; end; $$;

revoke execute on function public.safe_numeric(text) from public, anon, authenticated;
revoke execute on function public.safe_int(text)     from public, anon, authenticated;
revoke execute on function public.safe_bool(text, boolean) from public, anon, authenticated;
revoke execute on function public.safe_date(text)    from public, anon, authenticated;
