-- Ceilings on money, alerts when one is hit, and a count of how often the
-- model provider made us ask twice.
--
-- The page ledger caps PAGES, which is the right unit for a teacher. It is not
-- a cap on dollars: a dense PDF at high detail, a client stuck in a loop, or a
-- pricing mistake all stay inside the page quota while costing many times what
-- a page normally costs. These are the stops for that.
--
-- Sized against what the project has actually spent, not a guess. Across every
-- scan ever recorded: a graded page averages $0.008 and the dearest one on
-- record is $0.090; a standards-catalog run averages $0.115 and peaks at
-- $0.159, which is why catalog is admin-only. Total spend to date, all time,
-- is $1.02. The caps below are more than ten times normal heavy use. They are
-- there to stop a runaway, not to ration a teacher.

-- ---------------------------------------------------------------
-- How much a teacher may spend in a day
-- ---------------------------------------------------------------

-- Null means no cap. Beta is comped and deliberately uncapped.
alter table public.plans
  add column if not exists daily_cost_cap_usd numeric;

comment on column public.plans.daily_cost_cap_usd is
  'Ceiling on AI spend per teacher per Pacific calendar day. Null means no cap (beta). A runaway stop, not a ration: at $0.008 a graded page, $0.50 is ~60 pages, and the free plan only allows 36 a month.';

update public.plans set daily_cost_cap_usd = 0.50 where id = 'free';
update public.plans set daily_cost_cap_usd = 2.00 where id = 'tier1';
update public.plans set daily_cost_cap_usd = 3.00 where id = 'tier2';
update public.plans set daily_cost_cap_usd = 4.00 where id = 'tier3';
update public.plans set daily_cost_cap_usd = null where id = 'beta';
-- starter and team are inactive; give them the tier1 figure so that
-- reactivating one never leaves it uncapped by accident.
update public.plans set daily_cost_cap_usd = 2.00 where id in ('starter', 'team');

-- ---------------------------------------------------------------
-- How much everyone together may spend in a day
-- ---------------------------------------------------------------

-- A key/value table rather than a row in pipeline_config.
--
-- pipeline_config is one row per AI stage, with columns model,
-- reasoning_effort and max_output_tokens. A settings row wearing a fake stage
-- name would be rejected by lib/pipeline-config.ts as malformed, logged as an
-- error on every load, and shown on the admin pipeline page as an unknown
-- stage. The admin UI for this still lives on that page; only the storage is
-- separate.
create table if not exists public.platform_settings (
  key text primary key,
  value numeric not null,
  notes text,
  updated_at timestamptz not null default now()
);

comment on table public.platform_settings is
  'Operator-tunable numbers that are not per-stage AI routing. Edited from the admin pipeline page.';

insert into public.platform_settings (key, value, notes)
values (
  'daily_platform_cost_cap_usd', 25.00,
  'Total AI spend allowed across all teachers in one Pacific day. Every scan pauses above this. Total spend on this project to date is about $1, so this is roughly 25x everything ever spent -- a runaway stop, not a budget.'
)
on conflict (key) do nothing;

alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from public, anon, authenticated;
grant all on public.platform_settings to service_role;

-- ---------------------------------------------------------------
-- Something went wrong that no teacher can fix
-- ---------------------------------------------------------------

create table if not exists public.platform_alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  message text not null,
  detail jsonb,
  -- Stops one condition filing an alert per request. A teacher hitting their
  -- daily cap at 9am would otherwise file one every time they pressed Grade
  -- for the rest of the day.
  dedupe_key text unique,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz
);

comment on table public.platform_alerts is
  'Operator-facing alerts for conditions a teacher cannot resolve: the AI account out of credit, a spend ceiling reached. Shown as a banner on the admin dashboard until acknowledged. A stand-in for error reporting until Sentry exists.';
comment on column public.platform_alerts.dedupe_key is
  'Unique where set. One alert per condition per day rather than one per request. Null for alerts that should always be recorded.';

create index if not exists platform_alerts_open_idx
  on public.platform_alerts (created_at desc)
  where acknowledged_at is null;

alter table public.platform_alerts enable row level security;
-- No policies for any role. Teachers have no business reading operational
-- alerts, and the admin surface reads them through the service client.
revoke all on public.platform_alerts from public, anon, authenticated;
grant all on public.platform_alerts to service_role;

-- ---------------------------------------------------------------
-- How many tries it took
-- ---------------------------------------------------------------

alter table public.scans
  add column if not exists attempts int not null default 1;

comment on column public.scans.attempts is
  'How many times the model provider was called for this scan, including the first. Greater than 1 means a transient failure was retried. Makes provider flakiness visible instead of guessed at.';
