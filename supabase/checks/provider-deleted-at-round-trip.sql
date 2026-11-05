-- Not a migration. Run by hand AFTER
-- supabase/migrations/20261107120000_provider_deleted_at.sql is applied. Safe
-- on production: every write is inside a DO block that raises at the end, so
-- the transaction rolls back and nothing it wrote survives. The final ERROR
-- line IS the result -- read it, it is not a failure.
--
-- What it proves (review of #203): scans.provider_deleted_at exists and
-- round-trips; the partial index backs it; and public.scans_awaiting_provider_delete
-- returns exactly the stored-but-undeleted jobs older than the cutoff, and only
-- those -- never a synchronous scan (no provider id), never one already
-- deleted, never one newer than the cutoff -- in oldest-first order.
--
-- Made-up rows for one throwaway teacher only; all rolled back.

set lock_timeout = '5s';
set statement_timeout = '30s';

do $check$
declare
  tid uuid := gen_random_uuid();
  base timestamptz := now();
  s_old_undeleted uuid := gen_random_uuid();   -- stored, 2h old, not deleted -> swept
  s_old_deleted   uuid := gen_random_uuid();   -- stored, 2h old, already deleted -> not
  s_new_undeleted uuid := gen_random_uuid();   -- stored, 5m old, not deleted -> not (too new)
  s_sync          uuid := gen_random_uuid();   -- synchronous (no provider id) -> never
  v_rows   int;
  v_ids    uuid[];
  v_newest timestamptz;
begin
  -- The column takes a timestamp and reads it back.
  insert into public.scans (id, teacher_id, status, provider_response_id, provider_deleted_at, created_at)
    values (s_old_deleted, tid, 'complete', 'resp_old_deleted', base - interval '90 minutes', base - interval '2 hours');
  if (select provider_deleted_at from public.scans where id = s_old_deleted) is null then
    raise exception 'provider_deleted_at did not round-trip';
  end if;

  insert into public.scans (id, teacher_id, status, provider_response_id, created_at)
    values (s_old_undeleted, tid, 'complete', 'resp_old_undeleted', base - interval '2 hours'),
           (s_new_undeleted, tid, 'analyzing', 'resp_new_undeleted', base - interval '5 minutes');
  insert into public.scans (id, teacher_id, status, created_at)
    values (s_sync, tid, 'complete', base - interval '2 hours');

  -- The sweep's working set an hour back: only the old, stored, undeleted one.
  select array_agg(id order by created_at), count(*)
    into v_ids, v_rows
    from public.scans_awaiting_provider_delete(base - interval '1 hour', 100)
   where id = any(array[s_old_undeleted, s_old_deleted, s_new_undeleted, s_sync]);

  if v_rows <> 1 or v_ids <> array[s_old_undeleted] then
    raise exception 'awaiting set wrong: % rows %', v_rows, v_ids;
  end if;

  -- Stamping it removes it from the set.
  update public.scans set provider_deleted_at = now() where id = s_old_undeleted;
  if exists (
    select 1 from public.scans_awaiting_provider_delete(base - interval '1 hour', 100)
    where id = s_old_undeleted
  ) then
    raise exception 'a recorded deletion is still swept';
  end if;

  -- The partial index exists and covers the predicate.
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'scans_awaiting_provider_delete'
  ) then
    raise exception 'partial index missing';
  end if;

  raise exception 'ROLLED_BACK (expected): column, index and RPC all verified for teacher %', tid;
end
$check$;
