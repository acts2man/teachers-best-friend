create table if not exists public.teacher_workspaces (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  revision integer not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.teacher_uploads (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 180),
  object_path text not null unique,
  mime text not null check (mime in ('application/pdf','image/jpeg','image/png','image/webp')),
  size integer not null check (size > 0 and size <= 8388608),
  created_at timestamptz not null default now()
);

create index if not exists idx_teacher_uploads_owner
  on public.teacher_uploads (owner_id, created_at desc);

alter table public.teacher_workspaces enable row level security;
alter table public.teacher_uploads enable row level security;

create policy "Teachers read own workspace"
  on public.teacher_workspaces for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "Teachers create own workspace"
  on public.teacher_workspaces for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy "Teachers update own workspace"
  on public.teacher_workspaces for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "Teachers delete own workspace"
  on public.teacher_workspaces for delete to authenticated
  using ((select auth.uid()) = owner_id);

create policy "Teachers read own uploads"
  on public.teacher_uploads for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "Teachers create own uploads"
  on public.teacher_uploads for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy "Teachers delete own uploads"
  on public.teacher_uploads for delete to authenticated
  using ((select auth.uid()) = owner_id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.teacher_workspaces to authenticated;
grant select, insert, delete on public.teacher_uploads to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'teacher-documents',
  'teacher-documents',
  false,
  8388608,
  array['application/pdf','image/jpeg','image/png','image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Teachers read own documents"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'teacher-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "Teachers upload own documents"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'teacher-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "Teachers update own documents"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'teacher-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'teacher-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "Teachers delete own documents"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'teacher-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
