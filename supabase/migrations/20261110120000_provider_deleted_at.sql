-- When we deleted the AI provider's copy of a background job.
--
-- Background requests are now sent with store:false, so the provider deletes
-- its copy automatically within about 10 minutes. We also delete it on collect
-- (belt and braces) and stamp this column; a one-time admin backfill
-- (app/api/admin/provider-backfill) does the same for every past scan that
-- still carries a provider_response_id -- clearing the old store:true backlog --
-- so these two counts let us prove nothing is left. A row given up on after 5
-- failed deletes stops being retried, so it can never reach 0 in the first
-- count; split it out as `given_up` for a human to look at (expected 0):
--
--   -- remaining to delete (expect 0 once the backfill has run to completion):
--   select count(*) from public.scans
--    where provider_response_id is not null and provider_deleted_at is null
--      and provider_delete_attempts < 5;
--   -- given up on after 5 failed deletes (expect 0; if >0, list the ids for a
--   -- human decision):
--   select count(*) from public.scans
--    where provider_response_id is not null and provider_deleted_at is null
--      and provider_delete_attempts >= 5;
--
-- Additive and nullable: the synchronous path never sets it, and an existing
-- background row reads null until it is deleted. Safe to apply ahead of the
-- code. NOT APPLIED by merging -- migrations here are applied by hand.

set lock_timeout = '5s';

alter table public.scans
  add column if not exists provider_deleted_at timestamptz;

comment on column public.scans.provider_deleted_at is
  'When the AI provider''s stored copy of this background job was deleted. Null: never stored there (synchronous path), or not deleted yet (the backfill will).';

-- A delete can fail permanently (a revoked key 401/403s, a provider id that
-- never resolves). Without a record of that, the backfill re-selects the same
-- oldest 50 rows every pass and wedges on them. These two columns let it count
-- the attempts and give up on a row after too many, so a stuck row is reported
-- rather than blocking every row behind it forever.
alter table public.scans
  add column if not exists provider_delete_attempts integer not null default 0;
alter table public.scans
  add column if not exists provider_delete_last_error_at timestamptz;

comment on column public.scans.provider_delete_attempts is
  'How many times the backfill has tried and failed to delete the provider copy. The backfill orders by this (then created_at) and gives up on a row at 5.';

-- The backfill reads exactly this set -- a scan with a provider copy not yet
-- recorded as deleted that has not been given up on -- so a partial index keeps
-- it a cheap lookup. Ordered by attempts then created_at: rows that have never
-- failed come first, a wedged row sinks to the back.
drop index if exists scans_provider_copy_pending;
create index if not exists scans_provider_copy_pending
  on public.scans (provider_delete_attempts, created_at)
  where provider_response_id is not null and provider_deleted_at is null;
