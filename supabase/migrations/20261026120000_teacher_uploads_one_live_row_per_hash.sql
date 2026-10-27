-- One live teacher_uploads row per teacher per content hash. NOT applied by the
-- author -- apply by hand before merging. Proof:
-- supabase/checks/teacher-uploads-one-row-per-hash.sql, run by hand AFTER this
-- file by the reviewer; it rolls itself back.
--
-- Why (review of #171): a retried upload POST -- the browser's own retry, or a
-- function that stored the row and then lost its answer -- could insert a
-- second row for the same bytes. The browser looks the file up by hash before
-- each retry, but nothing in the database stopped two rows, and two POSTs in
-- flight at once both pass that lookup. Production had 2 such duplicate pairs
-- on 26 Oct 2026 (read-only count).
--
-- What this does:
--   1. superseded_by: the existing duplicates are not deleted -- assessments
--      may reference either id -- but every live row except the newest of its
--      (owner, hash) group is marked as superseded by it.
--   2. A unique index on (owner_id, content_sha256) over live rows: not purged
--      and not superseded. A purged row (file deleted by the 30-day purge) never
--      blocks a fresh upload of the same bytes.
--   3. The insert reuses the existing row: a BEFORE INSERT trigger finds a live
--      row with the same owner and hash, gives it the retention a new upload
--      would have had (its file is now in use again), and skips the insert. The
--      API then returns that row's id (lib/teacher-server.ts saveDocument), so
--      the browser gets the existing upload, never a second one. Two inserts at
--      the same instant can both pass the trigger; the index stops the second,
--      and saveDocument reuses the row on that unique violation too.
--
-- The page ledger was already keyed on (teacher, content hash), so no change
-- here affects what anyone is charged.

set lock_timeout = '5s';

alter table public.teacher_uploads
  add column if not exists superseded_by uuid references public.teacher_uploads(id) on delete set null;

comment on column public.teacher_uploads.superseded_by is
  'Set on an older duplicate (same owner and content hash) that existed before one live row per hash was enforced; the newer row is the one reused. The older row and its file stay for anything that still references them.';

-- 1. Existing duplicates: keep the newest live row of each group.
with ranked as (
  select id,
         first_value(id) over w as keep,
         row_number() over w as rn
    from public.teacher_uploads
   where purged_at is null
     and superseded_by is null
     and content_sha256 is not null
  window w as (partition by owner_id, content_sha256 order by created_at desc, id desc)
)
update public.teacher_uploads u
   set superseded_by = r.keep
  from ranked r
 where u.id = r.id
   and r.rn > 1;

-- 2. One live row per owner + hash.
create unique index if not exists teacher_uploads_one_live_row_per_hash
  on public.teacher_uploads (owner_id, content_sha256)
  where purged_at is null and superseded_by is null;

-- 3. An insert for bytes the teacher already has reuses that row.
create or replace function public.teacher_uploads_reuse_live_row()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  existing uuid;
begin
  if new.content_sha256 is null then
    return new; -- teacher_uploads_require_hash refuses it
  end if;
  select id into existing
    from public.teacher_uploads
   where owner_id = new.owner_id
     and content_sha256 = new.content_sha256
     and purged_at is null
     and superseded_by is null
   limit 1;
  if existing is null then
    return new;
  end if;
  -- In use again: keep it at least as long as a new upload would be kept.
  update public.teacher_uploads
     set expires_at = greatest(expires_at, now() + interval '30 days')
   where id = existing;
  return null; -- no second row
end
$function$;

-- create or replace (Postgres 14+; production is 17): applying this twice is
-- a no-op, and the migration tool refuses DROP.
create or replace trigger teacher_uploads_reuse_live_row
  before insert on public.teacher_uploads
  for each row execute function public.teacher_uploads_reuse_live_row();
