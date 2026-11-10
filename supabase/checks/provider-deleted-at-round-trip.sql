-- Not a migration. Run by hand AFTER
-- supabase/migrations/20261110120000_provider_deleted_at.sql is applied. Safe
-- on production: every write is inside a DO block that raises at the end, so the
-- transaction rolls back and nothing it wrote survives. The final ERROR line IS
-- the result -- read it, it is not a failure.
--
-- What it proves: scans.provider_deleted_at exists and round-trips; the partial
-- index backs the backfill's lookup; and the backfill's query -- a scan with a
-- provider_response_id and provider_deleted_at null -- returns exactly the
-- not-yet-deleted ones (never a synchronous scan with no provider id, never one
-- already stamped), and stamping a row removes it from that set.
--
-- Made-up rows for one throwaway teacher only; all rolled back.

set lock_timeout = '5s';
set statement_timeout = '30s';

do $check$
declare
  tid uuid := gen_random_uuid();
  pending_a uuid := gen_random_uuid();  -- has a provider id, not deleted -> backfilled
  pending_b uuid := gen_random_uuid();  -- has a provider id, not deleted -> backfilled
  done      uuid := gen_random_uuid();  -- has a provider id, already deleted -> not
  sync_scan uuid := gen_random_uuid();  -- synchronous, no provider id -> never
  v_rows int;
  v_ids  uuid[];
begin
  insert into public.scans (id, teacher_id, status, provider_response_id, provider_deleted_at, created_at) values
    (pending_a, tid, 'complete', 'resp_a', null,                        now() - interval '2 hours'),
    (pending_b, tid, 'failed',   'resp_b', null,                        now() - interval '1 hour'),
    (done,      tid, 'complete', 'resp_c', now() - interval '30 minutes', now() - interval '2 hours');
  insert into public.scans (id, teacher_id, status, created_at) values
    (sync_scan, tid, 'complete', now() - interval '2 hours');

  -- provider_deleted_at round-trips.
  if (select provider_deleted_at from public.scans where id = done) is null then
    raise exception 'provider_deleted_at did not round-trip';
  end if;

  -- The backfill's working set: only the two pending ones, oldest first.
  select array_agg(id order by created_at), count(*) into v_ids, v_rows
    from public.scans
   where provider_response_id is not null
     and provider_deleted_at is null
     and id = any(array[pending_a, pending_b, done, sync_scan]);
  if v_rows <> 2 or v_ids <> array[pending_a, pending_b] then
    raise exception 'pending set wrong: % rows %', v_rows, v_ids;
  end if;

  -- Stamping one removes it from the set.
  update public.scans set provider_deleted_at = now() where id = pending_a;
  if exists (
    select 1 from public.scans
     where id = pending_a and provider_response_id is not null and provider_deleted_at is null
  ) then
    raise exception 'a recorded deletion is still pending';
  end if;

  if not exists (
    select 1 from pg_indexes where schemaname = 'public' and indexname = 'scans_provider_copy_pending'
  ) then
    raise exception 'partial index missing';
  end if;

  raise exception 'ROLLED_BACK (expected): column, index and backfill query verified for teacher %', tid;
end
$check$;
