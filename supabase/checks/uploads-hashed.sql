-- No uploaded page created after the fix has a null content_sha256.
--
-- content_sha256 is the ledger's identity for a page: it is what stops the same
-- bytes being charged twice and what create_scan records as a scan's
-- charge_keys. The 25 uncounted scans of 2026-09-22 came in with null hashes
-- because the leaked permalink's build predated the hash column. Going forward,
-- the teacher_uploads_require_hash trigger (see migration
-- 20260923170000_a_scan_cannot_exist_uncharged.sql) refuses an INSERT with a
-- null hash, so this can never recur.
--
-- Safe to run against production: read-only.
--
-- The cutoff is the moment the require-hash trigger went live on production
-- (2026-09-23 23:00 UTC). It is deliberately AFTER the leaked permalink's last
-- null-hash upload (2026-09-23 03:00:47 UTC = the evening of 2026-09-22
-- Pacific), so those pre-fix rows -- the 25 uncounted scans' uploads -- are
-- excluded and left in place on purpose (Part 5 / docs/incident-response.md).
-- The trigger makes a post-cutoff null impossible, so this asserts the trigger
-- is doing its job.

-- Reporting first.
select
  count(*)                                          as uploads_since_fix,
  count(*) filter (where content_sha256 is null)    as null_hashes
from public.teacher_uploads
where created_at >= timestamptz '2026-09-23 23:00:00+00';

-- Assertion.
do $$
declare
  v_since timestamptz := timestamptz '2026-09-23 23:00:00+00';
  v_bad   int;
  v_ids   text;
begin
  select count(*), coalesce(string_agg(id::text, ', ' order by created_at), '')
    into v_bad, v_ids
    from public.teacher_uploads
   where created_at >= v_since
     and content_sha256 is null;

  if v_bad > 0 then
    raise exception 'FAIL: % teacher_uploads created since % have a null content_sha256: %', v_bad, v_since, v_ids;
  end if;
  raise notice 'PASS: no teacher_uploads created since % has a null content_sha256', v_since;
end $$;
