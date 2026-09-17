-- Extensions
create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------
-- PLANS  (global reference data — the pricing tiers)
-- ---------------------------------------------------------------
create table if not exists public.plans (
  id                     text primary key,
  name                   text        not null,
  price_cents            integer     not null default 0,
  scan_quota             integer     not null,
  overage_cents_per_100  integer,
  seat_based             boolean     not null default false,
  sort_order             integer     not null default 0,
  active                 boolean     not null default true,
  created_at             timestamptz not null default now()
);

comment on table public.plans is
  'Subscription tiers. scan_quota is the monthly scan allowance and is the
   unit the entire pricing model meters on. Change prices here, not in code.';

insert into public.plans (id, name, price_cents, scan_quota, overage_cents_per_100, seat_based, sort_order) values
  ('free',    'Free',     0,   20,  null,  false, 1),
  ('starter', 'Starter',  900, 150, 500,   false, 2),
  ('pro',     'Pro',      1900, 500, 500,  false, 3),
  ('team',    'Team',     1500, 500, 500,  true,  4)
on conflict (id) do nothing;

-- ---------------------------------------------------------------
-- PROFILES  (one per authenticated teacher)
-- ---------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  full_name     text,
  school_name   text,
  district      text,
  grade_levels  text[]      not null default '{}',
  subjects      text[]      not null default '{}',
  onboarded_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- SUBSCRIPTIONS  (current plan + billing period per teacher)
-- ---------------------------------------------------------------
create table if not exists public.subscriptions (
  teacher_id             uuid primary key references auth.users(id) on delete cascade,
  plan_id                text        not null references public.plans(id) default 'free',
  status                 text        not null default 'active'
                           check (status in ('active','past_due','canceled','trialing')),
  current_period_start   date        not null default date_trunc('month', now())::date,
  current_period_end     date        not null default (date_trunc('month', now()) + interval '1 month')::date,
  stripe_customer_id     text,
  stripe_subscription_id text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists subscriptions_plan_idx on public.subscriptions (plan_id);

-- ---------------------------------------------------------------
-- Auto-provision profile + free subscription on signup
-- ---------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;

  insert into public.subscriptions (teacher_id)
  values (new.id)
  on conflict (teacher_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------
-- Shared updated_at trigger
-- ---------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch      before update on public.profiles      for each row execute function public.touch_updated_at();
create trigger subscriptions_touch before update on public.subscriptions for each row execute function public.touch_updated_at();
