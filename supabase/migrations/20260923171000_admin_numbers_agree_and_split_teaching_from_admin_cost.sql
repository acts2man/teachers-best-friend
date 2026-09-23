-- Two admin dashboards were telling the owner different numbers.
--
-- Bug 1 -- the same word, two meanings.
--   The Accounts overview reads the page ledger (current_period_scan_count):
--   pages actually billed against quota. The Usage & cost page's unit
--   economics reads the raw scan log: billable, completed model calls. Both
--   were labelled "Scans", so the owner saw 0 on one screen and 42/6/3 on the
--   other for the same teachers and period and could not reconcile them.
--
--   They count genuinely different things -- billed pages (the meter) versus AI
--   calls (the cost driver) -- and both belong on the dashboard. The fix is to
--   stop calling both "Scans": the ledger meter now appears on BOTH pages from
--   the same source (this view gains pages_billed, from the same page_charges
--   the accounts overview reads), and the raw count is labelled "AI calls".
--   Where each page names the meter it now shows the same number; where it
--   names AI calls it says so.
--
-- Bug 2 -- admin work counted as a teacher's cost.
--   For troy@ the page showed $0.57 AI cost against 3 scans, but $0.46 of that
--   was four admin standards-library loads (billable = false, deliberately
--   unbilled); his actual teaching cost was $0.10. ai_cost_usd summed EVERY row
--   while scans and avg_cost_per_scan counted only billable, completed ones, so
--   the per-scan figure divided the small cost while the cost column showed the
--   large one, and the margin subtracted admin work the teacher never ran.
--
--   This splits the cost: teaching_cost_usd (the teacher's own billable,
--   completed scans) and admin_cost_usd (work billed to nobody). The per-scan
--   figure and the margin now both use teaching cost; admin/library cost is
--   shown beside it, never inside it. ai_cost_usd stays as the true total so the
--   money still reconciles.

create or replace view public.teacher_unit_economics
with (security_invoker = true) as
with scan_agg as (
  select
    s.teacher_id,
    date_trunc('month', s.created_at)::date as period,
    -- "AI calls" that count as teaching scans: billable, completed model calls.
    -- The denominator the per-scan figure is divided by, paired below with
    -- teaching cost so the two describe the same set of rows.
    count(*) filter (where s.billable and s.status = 'complete') as scans,
    -- The teacher's own scans.
    round(coalesce(sum(s.cost_usd) filter (where s.billable and s.status = 'complete'), 0), 4) as teaching_cost_usd,
    -- Work the app did that is billed to nobody: admin standards-library loads
    -- run billable = false. Kept out of the teacher's per-scan cost and margin.
    round(coalesce(sum(s.cost_usd) filter (where not s.billable), 0), 4) as admin_cost_usd,
    -- Every cent spent under this account this month (teaching + admin + the $0
    -- of failed scans), so the totals still add up to real money.
    round(coalesce(sum(s.cost_usd), 0), 4) as ai_cost_usd,
    round(avg(s.cost_usd) filter (where s.billable and s.status = 'complete'), 6) as avg_cost_per_scan,
    sum(s.library_hits)   as library_hits,
    sum(s.library_misses) as library_misses
  from public.scans s
  group by s.teacher_id, date_trunc('month', s.created_at)
),
ledger_agg as (
  -- Pages billed against quota, from the same ledger the teacher's meter and
  -- the accounts overview read, bucketed by the month a page was reserved in.
  -- This is the number that makes the two pages agree on "the meter".
  select
    c.teacher_id,
    date_trunc('month', c.reserved_at)::date as period,
    sum(c.pages)::int as pages_billed
  from public.page_charges c
  where c.released_at is null
  group by c.teacher_id, date_trunc('month', c.reserved_at)
)
-- Existing columns are kept in their existing order (CREATE OR REPLACE VIEW can
-- only append), with gross_margin_usd's EXPRESSION redefined to use teaching
-- cost. The three new columns -- the ledger meter and the teaching/admin split
-- -- are appended at the end. The Usage page reads by name, so order is
-- immaterial to it.
select
  sa.teacher_id,
  sub.plan_id,
  p.price_cents / 100.0                          as plan_price_usd,
  p.scan_quota,
  sa.period,
  sa.scans,
  sa.ai_cost_usd,
  sa.avg_cost_per_scan,
  sa.library_hits,
  sa.library_misses,
  round(100.0 * sa.library_hits / nullif(sa.library_hits + sa.library_misses, 0), 1) as cache_hit_rate_pct,
  -- Margin = what they pay minus what THEIR scans cost. Never minus admin work.
  round(p.price_cents / 100.0 - sa.teaching_cost_usd, 4) as gross_margin_usd,
  coalesce(la.pages_billed, 0)                   as pages_billed,
  sa.teaching_cost_usd,
  sa.admin_cost_usd
from scan_agg sa
join public.subscriptions sub on sub.teacher_id = sa.teacher_id
join public.plans p           on p.id = sub.plan_id
left join ledger_agg la on la.teacher_id = sa.teacher_id and la.period = sa.period;

-- CREATE OR REPLACE VIEW restores default grants, so re-assert them
-- (see 20260915013908). security_invoker was set in the create above.
revoke all on public.teacher_unit_economics from anon, authenticated;
grant select on public.teacher_unit_economics to service_role;
