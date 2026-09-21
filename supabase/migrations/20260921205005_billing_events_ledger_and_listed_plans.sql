-- The idempotency ledger for Stripe webhooks.
--
-- Stripe retries a webhook until it gets a 2xx, and it does not promise
-- exactly-once delivery: the same event can arrive twice, and two deliveries
-- can be in flight at the same time. Processing one twice is not a cosmetic
-- problem here -- it is a teacher's plan written twice, or an out-of-order
-- replay putting them back on a cheaper tier.
--
-- Same shape as public.page_charges: the guarantee is a primary key, not a
-- rule the handler has to remember. The handler inserts event.id FIRST, before
-- doing any work. If the insert conflicts the event has been seen, and the
-- handler returns 200 without acting.
--
-- processed_at is what separates "seen" from "done". An event that was stored
-- and then failed halfway leaves processed_at null and error set, and the next
-- delivery is allowed to retry the work. Only a row with processed_at set is a
-- no-op. Without that split, one failed attempt would poison the event
-- forever: stored, so skipped, but never actually applied.
create table if not exists public.billing_events (
  event_id text primary key,
  type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);

comment on table public.billing_events is
  'Every Stripe webhook event id we have seen. The primary key is what makes processing one twice impossible rather than merely unlikely. processed_at null with error set means stored but not applied -- the next delivery retries it.';
comment on column public.billing_events.processed_at is
  'Set only when the event has been fully applied. Null means a later delivery may still do the work.';
comment on column public.billing_events.error is
  'Why the last attempt failed. Kept so a stuck event can be diagnosed from the table instead of the Stripe dashboard.';

create index if not exists billing_events_unprocessed_idx
  on public.billing_events (received_at)
  where processed_at is null;

alter table public.billing_events enable row level security;

-- No policies at all, for any role. A teacher has no business reading the
-- webhook log, and the route that writes it uses the service client, which
-- bypasses RLS. Enabling RLS with no policy is the closed door.
revoke all on public.billing_events from public, anon, authenticated;
grant all on public.billing_events to service_role;

-- Which plans the public homepage offers.
--
-- Separate from `active` because they answer different questions. `active`
-- means the plan works -- a teacher can be on it, admin can assign it, its
-- quota counts. `listed` means we are advertising it. Beta is both a real plan
-- (two accounts are on it) and not something a stranger should be able to pick
-- off the pricing page, and until now the homepage had no way to say that.
alter table public.plans
  add column if not exists listed boolean not null default true;

comment on column public.plans.listed is
  'Show this plan on the public pricing page. Distinct from active: beta is active (two accounts are on it, admin can assign it) but not listed.';

update public.plans set listed = false where id = 'beta';
