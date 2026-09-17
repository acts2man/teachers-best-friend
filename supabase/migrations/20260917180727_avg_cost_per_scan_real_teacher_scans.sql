-- ===============================================================
-- "Average cost per scan" should mean what a teacher would mean.
--
-- Every average on the admin dashboard was taken over every row in
-- public.scans. Two kinds of row do not belong in a figure a pilot
-- teacher reads as "what this costs me":
--
--   1. billable = false — internal/dev runs. Today that is the five
--      stage = 'catalog' rows: the standards-generation stopgap on
--      gpt-5.6-sol, 7-16 cents each, 59% of all spend ever recorded.
--   2. status <> 'complete' — failed and canceled scans cost $0 and
--      drag the average down, which is just as misleading.
--
-- This is a display filter. No scans row is deleted or modified; the
-- cost and volume totals next to the averages still count every row,
-- because that is real money that was really spent.
--
-- Each average now comes in two flavours: all time, and a 30-day
-- rolling window. The lifetime figure carries the gpt-5.6-terra era
-- (~6 cents a page) forever; the rolling one shows what the pipeline
-- costs on gpt-5.6-luna (~0.2 cents) once those scans age out.
-- ===============================================================

-- ---------------------------------------------------------------
-- Platform-wide averages
-- ---------------------------------------------------------------
create or replace view public.admin_platform_stats as
with period as (
  select date_trunc('month', now()) as start,
         date_trunc('month', now()) + interval '1 month' as "end"
)
select
  (select count(*) from public.profiles where status = 'active')                                        as teachers_total,
  (select count(*) from public.profiles p join auth.users u on u.id = p.id
     where coalesce(p.last_seen_at, u.last_sign_in_at) >= now() - interval '7 days')                    as teachers_active_7d,
  (select count(*) from public.profiles p join auth.users u on u.id = p.id
     where coalesce(p.last_seen_at, u.last_sign_in_at) >= now() - interval '30 days')                   as teachers_active_30d,
  (select count(*) from auth.users where created_at >= now() - interval '7 days')                       as signups_7d,
  (select count(*) from public.subscriptions s join public.plans p on p.id = s.plan_id
     where p.price_cents > 0 and s.status = 'active')                                                   as paying_teachers,
  (select coalesce(sum(p.price_cents), 0) / 100.0 from public.subscriptions s
     join public.plans p on p.id = s.plan_id where s.status = 'active')                                 as mrr_usd,
  (select count(*) from public.scans where created_at >= current_date)                                  as scans_today,
  (select count(*) from public.scans, period
     where created_at >= period.start and created_at < period."end")                                    as scans_this_month,
  (select coalesce(sum(cost_usd), 0) from public.scans, period
     where created_at >= period.start and created_at < period."end")                                    as ai_cost_this_month,

  -- Real teacher scans only, all time.
  (select coalesce(avg(cost_usd), 0) from public.scans
     where billable and status = 'complete')                                                            as avg_cost_per_scan,

  (select round(100.0 * sum(library_hits) / nullif(sum(library_hits) + sum(library_misses), 0), 1)
     from public.scans, period
    where created_at >= period.start and created_at < period."end")                                     as cache_hit_rate_pct,
  (select count(*) from public.scans
     where status = 'failed' and created_at >= now() - interval '24 hours')                             as failed_scans_24h,
  (select count(*) from public.support_tickets where status in ('open', 'escalated'))                   as open_tickets,
  (select count(*) from public.reteaching_library where review_status = 'auto')                         as reteaching_unreviewed,
  (select count(*) from public.reteaching_library where review_status <> 'retired')                     as reteaching_entries,
  (select count(*) from public.standards where teacher_id is null and active)                           as standards_seeded,
  (select coalesce(sum(tu.size), 0) from public.teacher_uploads tu where tu.purged_at is null)            as storage_bytes_total,
  (select count(*) from public.teacher_uploads
     where purged_at is null and expires_at <= now() + interval '7 days')                               as uploads_expiring_7d,

  -- Same filter, 30-day rolling window. New column, appended last.
  (select coalesce(avg(cost_usd), 0) from public.scans
     where billable and status = 'complete'
       and created_at >= now() - interval '30 days')                                                    as avg_cost_per_scan_30d;

-- ---------------------------------------------------------------
-- Per-teacher averages (the accounts overview reads these)
-- ---------------------------------------------------------------
create or replace view public.admin_accounts as
select
  u.id                                   as teacher_id,
  u.email,
  p.full_name,
  p.school_name,
  p.district,
  p.is_admin,
  p.status,
  p.status_reason,
  sub.plan_id,
  pl.name                                as plan_name,
  pl.price_cents,
  pl.scan_quota,
  u.created_at                           as signed_up_at,
  coalesce(p.last_seen_at, u.last_sign_in_at) as last_seen_at,
  (select count(*) from public.classes c where c.teacher_id = u.id and c.archived_at is null)           as classes,
  (select count(*) from public.students s where s.teacher_id = u.id and s.archived_at is null)          as students,
  (select count(*) from public.assessments a where a.teacher_id = u.id and a.archived_at is null)       as assessments,
  (select count(*) from public.teacher_uploads up where up.owner_id = u.id and up.purged_at is null)    as uploads,
  (select coalesce(sum(up.size), 0) from public.teacher_uploads up
     where up.owner_id = u.id and up.purged_at is null)                                                 as storage_bytes,
  (select count(*) from public.scans sc where sc.teacher_id = u.id and sc.billable
     and sc.created_at >= sub.current_period_start and sc.created_at < sub.current_period_end)          as scans_this_period,
  (select count(*) from public.scans sc where sc.teacher_id = u.id)                                     as scans_lifetime,
  (select coalesce(sum(sc.cost_usd), 0) from public.scans sc where sc.teacher_id = u.id
     and sc.created_at >= sub.current_period_start and sc.created_at < sub.current_period_end)          as ai_cost_this_period,
  (select coalesce(sum(sc.cost_usd), 0) from public.scans sc where sc.teacher_id = u.id)                as ai_cost_lifetime,
  (select max(sc.created_at) from public.scans sc where sc.teacher_id = u.id)                           as last_scan_at,
  (select count(*) from public.support_tickets t where t.teacher_id = u.id
     and t.status in ('open', 'escalated'))                                                             as open_tickets,
  sub.current_period_start,
  sub.current_period_end,
  sub.stripe_customer_id,
  p.is_app_manager,

  -- New columns, appended last. Real teacher scans only.
  -- The accounts page used to divide ai_cost_this_period (every row) by
  -- scans_this_period (billable rows only), which is not an average of
  -- anything: a single unbillable catalog run inflated a teacher's
  -- per-scan cost even though they never ran it.
  (select coalesce(avg(sc.cost_usd), 0) from public.scans sc
     where sc.teacher_id = u.id and sc.billable and sc.status = 'complete')                             as avg_cost_per_scan,
  (select coalesce(avg(sc.cost_usd), 0) from public.scans sc
     where sc.teacher_id = u.id and sc.billable and sc.status = 'complete'
       and sc.created_at >= now() - interval '30 days')                                                 as avg_cost_per_scan_30d
from auth.users u
join public.profiles p             on p.id = u.id
left join public.subscriptions sub on sub.teacher_id = u.id
left join public.plans pl          on pl.id = sub.plan_id;

-- ---------------------------------------------------------------
-- Unit economics: the per-scan column, month by month
-- `scans` here already counted billable + complete only, so the
-- average was being taken over a different set of rows than the
-- count sitting next to it.
-- ---------------------------------------------------------------
create or replace view public.teacher_unit_economics
with (security_invoker = true) as
select
  s.teacher_id,
  sub.plan_id,
  p.price_cents / 100.0                                       as plan_price_usd,
  p.scan_quota,
  date_trunc('month', s.created_at)::date                     as period,
  count(*) filter (where s.billable and s.status = 'complete') as scans,
  round(sum(s.cost_usd), 4)                                   as ai_cost_usd,
  round(avg(s.cost_usd) filter (where s.billable and s.status = 'complete'), 6) as avg_cost_per_scan,
  sum(s.library_hits)                                         as library_hits,
  sum(s.library_misses)                                       as library_misses,
  round(100.0 * sum(s.library_hits)
        / nullif(sum(s.library_hits) + sum(s.library_misses), 0), 1)            as cache_hit_rate_pct,
  round(p.price_cents / 100.0 - sum(s.cost_usd), 4)           as gross_margin_usd
from public.scans s
join public.subscriptions sub on sub.teacher_id = s.teacher_id
join public.plans p           on p.id = sub.plan_id
group by s.teacher_id, sub.plan_id, p.price_cents, p.scan_quota, date_trunc('month', s.created_at);

-- ---------------------------------------------------------------
-- CREATE OR REPLACE VIEW can reset reloptions and restore default
-- grants, so re-assert both (see 20260915013908).
-- ---------------------------------------------------------------
alter view public.admin_platform_stats set (security_invoker = off);
alter view public.admin_accounts       set (security_invoker = off);

revoke all on public.admin_platform_stats     from public, anon, authenticated;
revoke all on public.admin_accounts           from public, anon, authenticated;
revoke all on public.teacher_unit_economics   from anon, authenticated;
grant select on public.admin_platform_stats, public.admin_accounts, public.teacher_unit_economics to service_role;
