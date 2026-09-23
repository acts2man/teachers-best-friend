-- Every billable, complete, charging-mode scan has an attributable charge.
--
-- This is the query form of the invariant Part 2 makes structural: create_scan
-- performs the charge as it opens the scan row, so a billable, charging-mode
-- scan cannot exist uncharged. This check proves it against production and
-- reports the count.
--
-- Safe to run against production: read-only. It SELECTs, reports counts, and
-- raises only to signal a failure. Nothing is written, so there is nothing to
-- roll back.
--
-- "Attributable charge" = for a scan, every key in scans.charge_keys resolves to
-- a live page_charges row (teacher_id, content_sha256, released_at is null). The
-- charge_keys column and page_charges both key on the content hash, which
-- outlives the upload row, so this stays answerable after the file is purged.
--
-- The enforcement window is self-calibrating: it starts at the first scan that
-- carries charge_keys, which is the first scan the new create_scan opened, i.e.
-- when the enforcing code went live. Scans before that -- every scan the old
-- code ever wrote, including the one real production scan of 2026-09-23 that was
-- charged the old way but has no charge_keys, and the 25 uncounted scans of
-- 2026-09-22 -- are legitimately outside it and not flagged. (On the 25: see
-- Part 5 / docs/incident-response.md. They are a leaked-permalink failure, not
-- the teacher's usage; the account is a comped beta with a 5,000 quota so
-- nothing reconciles against a bill; and their uploads carry null hashes, so
-- there is no real ledger key to backfill. The invariant is forward-looking.)
-- If no scan carries charge_keys yet -- no billable scan has run since the
-- deploy -- there is nothing to verify and the check reports zero.

-- Reporting first: the numbers, so a run always shows today's count.
with since as (
  select min(created_at) as ts from public.scans where charge_keys is not null
)
select
  (select ts from since)                                                          as enforcement_started,
  count(*)                                                                         as scans_since_enforcement,
  count(*) filter (
    where s.charge_keys is null
       or cardinality(s.charge_keys) = 0
       or exists (
            select 1 from unnest(s.charge_keys) k
             where not exists (
               select 1 from public.page_charges c
                where c.teacher_id = s.teacher_id
                  and c.content_sha256 = k
                  and c.released_at is null
             )
          )
  )                                                                               as unattributed
from public.scans s, since
where since.ts is not null
  and s.created_at >= since.ts
  and s.billable
  and s.status = 'complete'
  and s.stage is distinct from 'name_strip'
  and s.stage is distinct from 'catalog';

-- Assertion: fail loudly if any of those scans has no attributable charge.
do $$
declare
  v_since timestamptz;
  v_total int;
  v_bad   int;
  v_ids   text;
begin
  select min(created_at) into v_since from public.scans where charge_keys is not null;
  if v_since is null then
    raise notice 'pages-charged: no scan carries charge_keys yet -- no billable scan since the deploy. Nothing to verify.';
    return;
  end if;

  select count(*) into v_total
    from public.scans s
   where s.created_at >= v_since
     and s.billable and s.status = 'complete'
     and s.stage is distinct from 'name_strip'
     and s.stage is distinct from 'catalog';

  select count(*), coalesce(string_agg(s.id::text, ', ' order by s.created_at), '')
    into v_bad, v_ids
    from public.scans s
   where s.created_at >= v_since
     and s.billable and s.status = 'complete'
     and s.stage is distinct from 'name_strip'
     and s.stage is distinct from 'catalog'
     and (
          s.charge_keys is null
       or cardinality(s.charge_keys) = 0
       or exists (
            select 1 from unnest(s.charge_keys) k
             where not exists (
               select 1 from public.page_charges c
                where c.teacher_id = s.teacher_id
                  and c.content_sha256 = k
                  and c.released_at is null
             )
          )
     );

  raise notice 'pages-charged: % billable, complete, charging-mode scans since %, % unattributed',
    v_total, v_since, v_bad;
  if v_bad > 0 then
    raise exception 'FAIL: % scan(s) since % have no attributable charge: %', v_bad, v_since, v_ids;
  end if;
  raise notice 'PASS: every billable, complete, charging-mode scan since % has a live charge for each key', v_since;
end $$;
