-- ---------------------------------------------------------------
-- MODEL PRICING  (rates live in data, not in code)
-- USD per 1,000,000 tokens. Cached input bills at 10% of input.
-- Verify against the provider's pricing page before relying on these.
-- ---------------------------------------------------------------
create table if not exists public.model_pricing (
  model                text primary key,
  provider             text        not null default 'openai',
  input_per_mtok       numeric(10,4) not null,
  cached_input_per_mtok numeric(10,4) not null,
  output_per_mtok      numeric(10,4) not null,
  notes                text,
  active               boolean     not null default true,
  updated_at           timestamptz not null default now()
);

insert into public.model_pricing (model, provider, input_per_mtok, cached_input_per_mtok, output_per_mtok, notes) values
  ('gpt-5.6-sol',   'openai',  4.0000, 0.4000, 20.0000, 'flagship; strongest vision overall'),
  ('gpt-5.6-terra', 'openai',  2.0000, 0.2000, 12.0000, 'balanced; recommended for stage 2 reteaching'),
  ('gpt-5.6-luna',  'openai',  0.2000, 0.0200,  1.2000, 'cheap tier; recommended for stage 1 extraction'),
  ('gpt-5.5',       'openai',  5.0000, 0.5000, 30.0000, 'benchmarks higher on OCR/extraction than sol'),
  ('gpt-5.4-mini',  'openai',  0.7500, 0.0750,  4.5000, null),
  ('gpt-5.4-nano',  'openai',  0.2000, 0.0200,  1.2500, null)
on conflict (model) do nothing;

alter table public.model_pricing enable row level security;
create policy model_pricing_read on public.model_pricing
  for select to authenticated using (active);

-- ---------------------------------------------------------------
-- Compute cost_usd from token counts automatically
-- ---------------------------------------------------------------
create or replace function public.compute_scan_cost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c numeric(12,8) := 0;
  r record;
begin
  if new.extract_model is not null then
    select * into r from public.model_pricing where model = new.extract_model;
    if found then
      c := c
         + (new.extract_input_tokens        / 1000000.0) * r.input_per_mtok
         + (new.extract_cached_input_tokens / 1000000.0) * r.cached_input_per_mtok
         + (new.extract_output_tokens       / 1000000.0) * r.output_per_mtok;
    end if;
  end if;

  if new.reteach_model is not null then
    select * into r from public.model_pricing where model = new.reteach_model;
    if found then
      c := c
         + (new.reteach_input_tokens        / 1000000.0) * r.input_per_mtok
         + (new.reteach_cached_input_tokens / 1000000.0) * r.cached_input_per_mtok
         + (new.reteach_output_tokens       / 1000000.0) * r.output_per_mtok;
    end if;
  end if;

  new.cost_usd := round(c, 6);
  return new;
end;
$$;

create trigger scans_compute_cost
  before update on public.scans
  for each row
  when (auth.uid() is null)   -- service-role writes only
  execute function public.compute_scan_cost();

-- ---------------------------------------------------------------
-- UNIT ECONOMICS VIEW  (ops-facing; service role)
-- This is the table you put in front of the founders.
-- ---------------------------------------------------------------
create or replace view public.teacher_unit_economics
with (security_invoker = true) as
select
  s.teacher_id,
  sub.plan_id,
  p.price_cents / 100.0                                   as plan_price_usd,
  p.scan_quota,
  date_trunc('month', s.created_at)::date                 as period,
  count(*) filter (where s.billable and s.status = 'complete') as scans,
  round(sum(s.cost_usd), 4)                               as ai_cost_usd,
  round(avg(s.cost_usd), 6)                               as avg_cost_per_scan,
  sum(s.library_hits)                                     as library_hits,
  sum(s.library_misses)                                   as library_misses,
  round(
    100.0 * sum(s.library_hits)
    / nullif(sum(s.library_hits) + sum(s.library_misses), 0), 1
  )                                                        as cache_hit_rate_pct,
  round(p.price_cents / 100.0 - sum(s.cost_usd), 4)       as gross_margin_usd
from public.scans s
join public.subscriptions sub on sub.teacher_id = s.teacher_id
join public.plans p           on p.id = sub.plan_id
group by s.teacher_id, sub.plan_id, p.price_cents, p.scan_quota, date_trunc('month', s.created_at);

-- ---------------------------------------------------------------
-- SUPPORT TICKETS
-- ---------------------------------------------------------------
create table if not exists public.support_tickets (
  id             uuid primary key default gen_random_uuid(),
  ticket_ref     text unique,
  teacher_id     uuid        not null references auth.users(id) on delete cascade,
  subject        text        not null check (char_length(subject) between 1 and 200),
  body           text        not null,
  category       text,
  status         text        not null default 'open'
                   check (status in ('open','ai_answered','escalated','resolved','closed')),
  priority       text        not null default 'normal'
                   check (priority in ('low','normal','high','urgent')),
  ai_answer      text,
  ai_confidence  numeric(4,3),
  deflected      boolean     not null default false,
  resolved_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.support_messages (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid        not null references public.support_tickets(id) on delete cascade,
  teacher_id  uuid        not null references auth.users(id) on delete cascade,
  author      text        not null check (author in ('teacher','ai','staff')),
  body        text        not null,
  created_at  timestamptz not null default now()
);

create sequence if not exists public.ticket_ref_seq;

create or replace function public.assign_ticket_ref()
returns trigger language plpgsql as $$
begin
  if new.ticket_ref is null then
    new.ticket_ref := 'TKT-' || lpad(nextval('public.ticket_ref_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

create trigger support_tickets_ref before insert on public.support_tickets
  for each row execute function public.assign_ticket_ref();
create trigger support_tickets_touch before update on public.support_tickets
  for each row execute function public.touch_updated_at();

create index if not exists tickets_teacher_idx on public.support_tickets (teacher_id);
create index if not exists tickets_open_idx    on public.support_tickets (status, created_at desc)
  where status in ('open','escalated');
create index if not exists support_messages_ticket_idx on public.support_messages (ticket_id);

alter table public.support_tickets  enable row level security;
alter table public.support_messages enable row level security;

create policy tickets_own_select on public.support_tickets
  for select to authenticated using (teacher_id = (select auth.uid()));
create policy tickets_own_insert on public.support_tickets
  for insert to authenticated with check (teacher_id = (select auth.uid()));
create policy messages_own_select on public.support_messages
  for select to authenticated using (teacher_id = (select auth.uid()));
create policy messages_own_insert on public.support_messages
  for insert to authenticated
  with check (teacher_id = (select auth.uid()) and author = 'teacher');
