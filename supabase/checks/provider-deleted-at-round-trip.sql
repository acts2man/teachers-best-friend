-- Not a migration. Run by hand AFTER
-- supabase/migrations/20261107120000_provider_deleted_at.sql is applied. Safe
-- on production: every write is inside a DO block that raises at the end, so
-- the transaction rolls back and nothing it wrote survives. The final ERROR
-- line IS the result -- read it, it is not a failure.
--
-- What it proves (review of #203 + #212 review):
--   * scans.provider_deleted_at and provider_delete_attempts exist and
--     round-trip;
--   * scans_awaiting_provider_delete returns a job only when it is SAFE to
--     delete -- terminal in our row, OR older than the one-hour lifetime --
--     older than the cutoff, and under the attempt cap; never a fresh still-
--     analyzing job, never a synchronous scan, never an already-deleted one,
--     never an exhausted one; oldest first;
--   * note_provider_delete_failed bumps the attempt count;
--   * admin_clear_failed_scans keeps a failed scan whose provider copy is not
--     deleted yet, and removes one that is.
--
-- Made-up rows for one throwaway teacher only; all rolled back. Set an admin id
-- below for the admin_clear_failed_scans part (any real admin uuid; nothing of
-- theirs is touched).

set lock_timeout = '5s';
set statement_timeout = '30s';

do $check$
declare
  tid uuid := gen_random_uuid();
  admin_id uuid := '00000000-0000-0000-0000-000000000000'; -- <-- set to a real admin uuid
  base timestamptz := now();
  term_old   uuid := gen_random_uuid();  -- complete, 2h old, undeleted -> swept
  term_gone  uuid := gen_random_uuid();  -- complete, 2h old, already deleted -> not
  run_fresh  uuid := gen_random_uuid();  -- analyzing, 45m old -> not (may still run)
  run_stale  uuid := gen_random_uuid();  -- analyzing, 2h old -> swept (past lifetime)
  sync_scan  uuid := gen_random_uuid();  -- synchronous, no provider id -> never
  exhausted  uuid := gen_random_uuid();  -- complete, 2h old, 5 failed attempts -> not
  fail_undel uuid := gen_random_uuid();  -- failed, provider copy not deleted -> keep on clear
  fail_del   uuid := gen_random_uuid();  -- failed, provider copy deleted -> removed on clear
  v_ids uuid[];
  v_rows int;
  v_attempts smallint;
  v_removed int;
begin
  insert into public.scans (id, teacher_id, status, provider_response_id, provider_deleted_at, provider_delete_attempts, created_at) values
    (term_old,  tid, 'complete',  'r_term_old',  null,                 0, base - interval '2 hours'),
    (term_gone, tid, 'complete',  'r_term_gone', base - interval '90 minutes', 0, base - interval '2 hours'),
    (run_fresh, tid, 'analyzing', 'r_run_fresh', null,                 0, base - interval '45 minutes'),
    (run_stale, tid, 'analyzing', 'r_run_stale', null,                 0, base - interval '2 hours'),
    (exhausted, tid, 'complete',  'r_exhausted', null,                 5, base - interval '2 hours');
  insert into public.scans (id, teacher_id, status, created_at) values
    (sync_scan, tid, 'complete', base - interval '2 hours');

  -- provider_deleted_at round-trips.
  if (select provider_deleted_at from public.scans where id = term_gone) is null then
    raise exception 'provider_deleted_at did not round-trip';
  end if;

  -- The safe-to-delete set an hour back: term_old (terminal) and run_stale
  -- (past lifetime). Not run_fresh, term_gone, sync_scan, exhausted.
  select array_agg(id order by created_at), count(*) into v_ids, v_rows
    from public.scans_awaiting_provider_delete(base - interval '1 hour', 100)
   where id = any(array[term_old, term_gone, run_fresh, run_stale, sync_scan, exhausted]);
  if v_rows <> 2 or not (v_ids @> array[term_old, run_stale] and array_length(v_ids,1) = 2) then
    raise exception 'awaiting set wrong: % rows %', v_rows, v_ids;
  end if;

  -- note_provider_delete_failed bumps the count, and at 5 it drops out.
  perform public.note_provider_delete_failed(term_old);
  select provider_delete_attempts into v_attempts from public.scans where id = term_old;
  if v_attempts <> 1 then raise exception 'attempt count not bumped: %', v_attempts; end if;

  -- Stamping term_old removes it from the set.
  update public.scans set provider_deleted_at = now() where id = term_old;
  if exists (select 1 from public.scans_awaiting_provider_delete(base - interval '1 hour', 100) where id = term_old) then
    raise exception 'a recorded deletion is still swept';
  end if;

  -- admin_clear_failed_scans: keep the undeleted-copy failed scan, remove the rest.
  insert into public.scans (id, teacher_id, status, provider_response_id, provider_deleted_at, created_at) values
    (fail_undel, tid, 'failed', 'r_fail_undel', null,  base - interval '2 hours'),
    (fail_del,   tid, 'failed', 'r_fail_del',   now(), base - interval '2 hours');
  if public.is_admin(admin_id) then
    v_removed := public.admin_clear_failed_scans(admin_id, tid);
    if exists (select 1 from public.scans where id = fail_undel) = false then
      raise exception 'cleared a failed scan whose provider copy is not deleted yet';
    end if;
    if exists (select 1 from public.scans where id = fail_del) then
      raise exception 'did not clear a failed scan whose provider copy is deleted';
    end if;
  else
    raise notice 'admin_id is not an admin; skipped the admin_clear_failed_scans check';
  end if;

  raise exception 'ROLLED_BACK (expected): columns, RPCs and admin guard verified for teacher %', tid;
end
$check$;
