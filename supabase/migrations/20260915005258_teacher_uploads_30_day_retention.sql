-- The app writes every uploaded worksheet to public.teacher_uploads, but the
-- retention columns and the nightly purge job only ever existed on the older
-- public.uploads table, which the app no longer writes to. The result: the
-- "we delete uploaded student work automatically" commitment in the privacy
-- policy has never actually run against the files it describes.
--
-- Give teacher_uploads the same retention contract, defaulting to the 30-day
-- window the student-privacy documentation commits to.

alter table public.teacher_uploads
  add column if not exists expires_at timestamptz not null default (now() + interval '30 days'),
  add column if not exists purged_at  timestamptz;

-- Existing rows get the same 30 days measured from when they were uploaded.
update public.teacher_uploads
   set expires_at = created_at + interval '30 days'
 where expires_at is null or expires_at > created_at + interval '30 days';

create index if not exists teacher_uploads_due_idx
  on public.teacher_uploads (expires_at)
  where purged_at is null;

-- Deletes the stored object first, then marks the row, so a row is never
-- reported as purged while its file is still in the bucket. Batched so one
-- run can never lock the table for long.
create or replace function public.purge_expired_teacher_uploads()
returns integer
language plpgsql
security definer
set search_path to 'public', 'storage'
as $function$
declare
  purged integer;
begin
  with due as (
    select id, object_path
      from public.teacher_uploads
     where purged_at is null
       and expires_at <= now()
     limit 500
  ), gone as (
    delete from storage.objects o
     using due
     where o.bucket_id = 'teacher-documents' and o.name = due.object_path
    returning o.name
  )
  update public.teacher_uploads u
     set purged_at = now()
    from due
   where u.id = due.id;

  get diagnostics purged = row_count;
  return purged;
end;
$function$;

revoke execute on function public.purge_expired_teacher_uploads() from public, anon, authenticated;

