-- When we deleted the AI provider's copy of a background job.
--
-- Background requests are now sent with store:false, so the provider deletes
-- its copy automatically about 10 minutes after the job finishes. We also
-- delete it on collect (belt and braces) and stamp this column; a one-time
-- admin backfill (app/api/admin/provider-backfill) does the same for every past
-- scan that still carries a provider_response_id -- clearing the old store:true
-- backlog -- so this column lets us prove nothing is left:
--
--   select count(*) from public.scans
--    where provider_response_id is not null and provider_deleted_at is null;
--   -- expect 0 after the backfill has run to completion.
--
-- Additive and nullable: the synchronous path never sets it, and an existing
-- background row reads null until it is deleted. Safe to apply ahead of the
-- code. NOT APPLIED by merging -- migrations here are applied by hand.

set lock_timeout = '5s';

alter table public.scans
  add column if not exists provider_deleted_at timestamptz;

comment on column public.scans.provider_deleted_at is
  'When the AI provider''s stored copy of this background job was deleted. Null: never stored there (synchronous path), or not deleted yet (the backfill will).';

-- The backfill reads exactly this set -- a scan with a provider copy not yet
-- recorded as deleted -- so a partial index keeps it a cheap lookup.
create index if not exists scans_provider_copy_pending
  on public.scans (created_at)
  where provider_response_id is not null and provider_deleted_at is null;
