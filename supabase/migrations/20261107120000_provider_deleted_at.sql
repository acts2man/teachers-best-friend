-- The moment we deleted the AI provider's stored copy of a background job
-- (review of #203). A background analysis is sent with store:true so it can be
-- read back; the provider keeps it until we delete it. The poll route deletes
-- it on every outcome and stamps this column; a scheduled sweep
-- (public.scans_awaiting_provider_delete + app/api/cron/provider-sweep)
-- deletes whatever is still there an hour on and stamps it too.
--
-- Additive and nullable: the synchronous path never sets it, and an existing
-- background row reads null until the sweep gets to it. Safe to apply ahead of
-- the code. NOT APPLIED by merging -- migrations here are applied by hand.

set lock_timeout = '5s';

alter table public.scans
  add column if not exists provider_deleted_at timestamptz;

comment on column public.scans.provider_deleted_at is
  'When the AI provider''s stored copy of this background job was deleted (review of #203). Null: never stored there (synchronous path), or not deleted yet (the sweep will).';

-- The sweep reads exactly this set -- a stored job, an hour old, not yet
-- deleted -- so a partial index keeps it a cheap lookup as the table grows.
create index if not exists scans_awaiting_provider_delete
  on public.scans (created_at)
  where provider_response_id is not null and provider_deleted_at is null;

-- The sweep's working set, oldest first: a finished-with background job whose
-- provider copy we have not recorded as deleted. `cutoff` is "older than"
-- (the route passes now() - 1 hour). Security definer so the service role can
-- read it; it returns ids only, never any job content.
create or replace function public.scans_awaiting_provider_delete(cutoff timestamptz, max_rows int default 100)
returns table (id uuid, provider_response_id text)
language sql
security definer
set search_path = public
as $$
  select id, provider_response_id
  from public.scans
  where provider_response_id is not null
    and provider_deleted_at is null
    and created_at < cutoff
  order by created_at
  limit greatest(1, least(max_rows, 1000));
$$;

revoke all on function public.scans_awaiting_provider_delete(timestamptz, int) from public, anon, authenticated;
