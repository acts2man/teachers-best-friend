-- Not a migration. Run by hand AFTER
-- supabase/migrations/20261110120000_provider_deleted_at.sql is applied. Safe
-- on production: every write is inside a DO block that raises at the end, so the
-- transaction rolls back and nothing it wrote survives. The final ERROR line IS
-- the result -- read it, it is not a failure.
--
-- What it proves: scans.provider_deleted_at, provider_delete_attempts and
-- provider_delete_last_error_at exist and round-trip; the partial index backs
-- the backfill's lookup; and the backfill's query returns exactly the rows the
-- backfill works -- a scan with a provider_response_id, provider_deleted_at
-- null, fewer than 5 failed attempts, not 'analyzing', older than an hour --
-- ordered fewest-attempts-then-oldest, and stamping a row removes it from that
-- set. It never returns a synchronous scan (no provider id), an in-flight job
-- ('analyzing' or younger than an hour), one already stamped, or one given up
-- on (>= 5 attempts).
--
-- scans.teacher_id is NOT NULL and references auth.users(id), so a random uuid
-- would violate scans_teacher_id_fkey before any assertion ran. This inserts a
-- throwaway auth.users row (as account-deletion.sql does) and hangs every scan
-- off it; the row rolls back with everything else. (teacher_id = null is not an
-- option here -- the column is NOT NULL.)
--
-- Made-up rows for one throwaway teacher only; all rolled back.

set lock_timeout = '5s';
set statement_timeout = '30s';

do $check$
declare
  tid uuid := gen_random_uuid();
  pending_a uuid := gen_random_uuid();  -- provider id, not deleted, old        -> backfilled (first: 0 attempts, oldest)
  pending_b uuid := gen_random_uuid();  -- provider id, not deleted, old         -> backfilled (second)
  done      uuid := gen_random_uuid();  -- provider id, already deleted          -> not
  sync_scan uuid := gen_random_uuid();  -- synchronous, no provider id           -> never
  inflight  uuid := gen_random_uuid();  -- provider id, 'analyzing', recent      -> left alone (in-flight)
  wedged    uuid := gen_random_uuid();  -- provider id, not deleted, 5 attempts  -> given up on
  v_rows int;
  v_ids  uuid[];
begin
  -- scans_teacher_id_fkey -> auth.users(id). One throwaway user to own them all.
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (tid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'provdel-' || tid || '@example.invalid', now(), now());

  insert into public.scans
    (id, teacher_id, status, provider_response_id, provider_deleted_at, provider_delete_attempts, created_at) values
    (pending_a, tid, 'complete',  'resp_a', null,                          0, now() - interval '3 hours'),
    (pending_b, tid, 'failed',    'resp_b', null,                          0, now() - interval '2 hours'),
    (done,      tid, 'complete',  'resp_c', now() - interval '30 minutes', 0, now() - interval '2 hours'),
    (inflight,  tid, 'analyzing', 'resp_d', null,                          0, now() - interval '5 minutes'),
    (wedged,    tid, 'failed',    'resp_e', null,                          5, now() - interval '4 hours');
  insert into public.scans (id, teacher_id, status, created_at) values
    (sync_scan, tid, 'complete', now() - interval '2 hours');

  -- The new columns round-trip.
  if (select provider_deleted_at from public.scans where id = done) is null then
    raise exception 'provider_deleted_at did not round-trip';
  end if;
  update public.scans set provider_delete_last_error_at = now() where id = wedged;
  if (select provider_delete_attempts from public.scans where id = wedged) <> 5
     or (select provider_delete_last_error_at from public.scans where id = wedged) is null then
    raise exception 'provider_delete_attempts/last_error_at did not round-trip';
  end if;

  -- The backfill's working set: only the two pending ones, fewest attempts then
  -- oldest. Not done (stamped), sync_scan (no id), inflight ('analyzing' AND
  -- younger than an hour), or wedged (>= 5 attempts).
  select array_agg(id order by provider_delete_attempts, created_at), count(*) into v_ids, v_rows
    from public.scans
   where provider_response_id is not null
     and provider_deleted_at is null
     and provider_delete_attempts < 5
     and status <> 'analyzing'
     and created_at < now() - interval '1 hour'
     and id = any(array[pending_a, pending_b, done, sync_scan, inflight, wedged]);
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

  raise exception 'ROLLED_BACK (expected): columns, index and backfill query verified for teacher %', tid;
end
$check$;
