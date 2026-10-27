-- Not a migration. Run by hand AFTER
-- supabase/migrations/20261026120000_teacher_uploads_one_live_row_per_hash.sql
-- has been applied -- by the reviewer, not by the PR's author. Pending until then.
-- Safe on production: no DDL, and every write is inside a DO block that raises
-- at the end, so the transaction rolls back and nothing it wrote survives (the
-- rows it inserts point at object paths that do not exist; no file is touched).
-- The final ERROR line IS the result -- read it, it is not a failure.
--
-- What it proves:
--   1. no live duplicate is left: every (owner, hash) has at most one row that
--      is neither purged nor superseded;
--   2. inserting a row for bytes the teacher already has adds no row, and the
--      existing row's retention is at least 30 days from now;
--   3. a purged row does not block a fresh upload of the same bytes;
--   4. the unique index that refuses a second live row (two inserts at once
--      both passing the trigger) exists and is unique and partial. Forcing
--      that race needs the trigger disabled, which is DDL, so it was proven on
--      a scratch Postgres for the PR instead, not here.
--
-- Set the teacher below to an account with at least one upload -- ideally
-- your own test account, not a pilot teacher's.

set lock_timeout = '5s';
set statement_timeout = '30s';

do $check$
declare
  tid uuid := '00000000-0000-0000-0000-000000000000'; -- <-- set this
  live_dupes int;
  probe text := 'check-' || gen_random_uuid()::text; -- a hash no real file has
  first_id uuid := gen_random_uuid();
  rows_after_reuse int;
  expiry_ok boolean;
  after_purge int;
  index_ok boolean;
begin
  select count(*) into live_dupes from (
    select owner_id, content_sha256 from public.teacher_uploads
     where purged_at is null and superseded_by is null and content_sha256 is not null
     group by 1, 2 having count(*) > 1) d;

  -- 2. The same bytes twice: one row; its retention renewed.
  insert into public.teacher_uploads (id, owner_id, name, object_path, mime, size, page_count, content_sha256, created_at, expires_at)
  values (first_id, tid, 'check.jpg', tid || '/' || first_id, 'image/jpeg', 1, 1, probe, now() - interval '29 days', now() + interval '1 day');
  insert into public.teacher_uploads (id, owner_id, name, object_path, mime, size, page_count, content_sha256)
  values (gen_random_uuid(), tid, 'check.jpg', tid || '/' || gen_random_uuid(), 'image/jpeg', 1, 1, probe);
  select count(*), bool_and(expires_at >= now() + interval '29 days')
    into rows_after_reuse, expiry_ok
    from public.teacher_uploads where owner_id = tid and content_sha256 = probe;

  -- 3. Once purged, the same bytes upload fresh.
  update public.teacher_uploads set purged_at = now() where id = first_id;
  insert into public.teacher_uploads (id, owner_id, name, object_path, mime, size, page_count, content_sha256)
  values (gen_random_uuid(), tid, 'check.jpg', tid || '/' || gen_random_uuid(), 'image/jpeg', 1, 1, probe);
  select count(*) into after_purge from public.teacher_uploads
   where owner_id = tid and content_sha256 = probe and purged_at is null;

  -- 4. The index behind it.
  select i.indisunique and i.indpred is not null into index_ok
    from pg_index i join pg_class c on c.oid = i.indexrelid
   where c.relname = 'teacher_uploads_one_live_row_per_hash';

  raise exception 'ROLLED_BACK expect live_dupes=0 rows_after_reuse=1 expiry_renewed=true live_after_purge=1 unique_partial_index=true | got live_dupes=% rows_after_reuse=% expiry_renewed=% live_after_purge=% unique_partial_index=%',
    live_dupes, rows_after_reuse, expiry_ok, after_purge, coalesce(index_ok, false);
end
$check$;
