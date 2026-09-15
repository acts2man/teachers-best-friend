-- ===============================================================
-- ADMIN READ MODELS. Service role only — revoked from app roles.
-- ===============================================================

-- One row per teacher: everything the accounts table needs
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
  (select count(*) from public.classes c where c.teacher_id = u.id and c.archived_at is null)        as classes,
  (select count(*) from public.students s where s.teacher_id = u.id and s.archived_at is null)       as students,
  (select count(*) from public.assessments a where a.teacher_id = u.id and a.archived_at is null)    as assessments,
  (select count(*) from public.uploads up where up.teacher_id = u.id and up.purged_at is null)       as uploads,
  (select coalesce(sum(up.size_bytes),0) from public.uploads up where up.teacher_id = u.id and up.purged_at is null) as storage_bytes,
  (select count(*) from public.scans sc where sc.teacher_id = u.id and sc.billable
      and sc.created_at >= sub.current_period_start and sc.created_at < sub.current_period_end)      as scans_this_period,
  (select count(*) from public.scans sc where sc.teacher_id = u.id)                                  as scans_lifetime,
  (select coalesce(sum(sc.cost_usd),0) from public.scans sc where sc.teacher_id = u.id
      and sc.created_at >= sub.current_period_start and sc.created_at < sub.current_period_end)      as ai_cost_this_period,
  (select coalesce(sum(sc.cost_usd),0) from public.scans sc where sc.teacher_id = u.id)              as ai_cost_lifetime,
  (select max(sc.created_at) from public.scans sc where sc.teacher_id = u.id)                        as last_scan_at,
  (select count(*) from public.support_tickets t where t.teacher_id = u.id and t.status in ('open','escalated')) as open_tickets,
  sub.current_period_start,
  sub.current_period_end,
  sub.stripe_customer_id
from auth.users u
join public.profiles p        on p.id = u.id
left join public.subscriptions sub on sub.teacher_id = u.id
left join public.plans pl     on pl.id = sub.plan_id;

-- Platform-wide numbers for the overview strip
create or replace view public.admin_platform_stats as
with period as (select date_trunc('month', now()) as start, date_trunc('month', now()) + interval '1 month' as "end")
select
  (select count(*) from public.profiles where status = 'active')                                        as teachers_total,
  (select count(*) from public.profiles p join auth.users u on u.id=p.id
     where coalesce(p.last_seen_at, u.last_sign_in_at) >= now() - interval '7 days')                    as teachers_active_7d,
  (select count(*) from public.profiles p join auth.users u on u.id=p.id
     where coalesce(p.last_seen_at, u.last_sign_in_at) >= now() - interval '30 days')                   as teachers_active_30d,
  (select count(*) from auth.users where created_at >= now() - interval '7 days')                       as signups_7d,
  (select count(*) from public.subscriptions s join public.plans p on p.id=s.plan_id where p.price_cents > 0 and s.status='active') as paying_teachers,
  (select coalesce(sum(p.price_cents),0)/100.0 from public.subscriptions s join public.plans p on p.id=s.plan_id where s.status='active') as mrr_usd,
  (select count(*) from public.scans where created_at >= current_date)                                  as scans_today,
  (select count(*) from public.scans, period where created_at >= period.start and created_at < period."end") as scans_this_month,
  (select coalesce(sum(cost_usd),0) from public.scans, period where created_at >= period.start and created_at < period."end") as ai_cost_this_month,
  (select coalesce(avg(cost_usd),0) from public.scans, period where created_at >= period.start and created_at < period."end" and status='complete') as avg_cost_per_scan,
  (select round(100.0 * sum(library_hits) / nullif(sum(library_hits)+sum(library_misses),0), 1)
     from public.scans, period where created_at >= period.start and created_at < period."end")         as cache_hit_rate_pct,
  (select count(*) from public.scans where status = 'failed' and created_at >= now() - interval '24 hours') as failed_scans_24h,
  (select count(*) from public.support_tickets where status in ('open','escalated'))                    as open_tickets,
  (select count(*) from public.reteaching_library where review_status = 'auto')                         as reteaching_unreviewed,
  (select count(*) from public.reteaching_library where review_status <> 'retired')                     as reteaching_entries,
  (select count(*) from public.standards where teacher_id is null and embedding is not null)            as standards_seeded,
  (select coalesce(sum(size_bytes),0) from public.uploads where purged_at is null)                      as storage_bytes_total,
  (select count(*) from public.uploads where purged_at is null and expires_at <= now() + interval '7 days') as uploads_expiring_7d;

-- Daily usage for the last 90 days
create or replace view public.admin_daily_usage as
select d::date as day,
       (select count(*) from public.scans s where s.created_at::date = d::date)                          as scans,
       (select count(distinct teacher_id) from public.scans s where s.created_at::date = d::date)        as active_teachers,
       (select coalesce(sum(cost_usd),0) from public.scans s where s.created_at::date = d::date)         as ai_cost,
       (select count(*) from public.scans s where s.created_at::date = d::date and status = 'failed')    as failed,
       (select coalesce(sum(library_hits),0) from public.scans s where s.created_at::date = d::date)     as cache_hits,
       (select coalesce(sum(library_misses),0) from public.scans s where s.created_at::date = d::date)   as cache_misses,
       (select count(*) from auth.users u where u.created_at::date = d::date)                            as signups
from generate_series(current_date - interval '89 days', current_date, interval '1 day') d
order by 1;

-- Cost by model this month
create or replace view public.admin_model_costs as
with period as (select date_trunc('month', now()) as start)
select m.model,
       coalesce(sum(case when s.extract_model = m.model then s.extract_input_tokens + s.extract_cached_input_tokens else 0 end)
              + sum(case when s.reteach_model = m.model then s.reteach_input_tokens + s.reteach_cached_input_tokens else 0 end), 0) as input_tokens,
       coalesce(sum(case when s.extract_model = m.model then s.extract_output_tokens else 0 end)
              + sum(case when s.reteach_model = m.model then s.reteach_output_tokens else 0 end), 0) as output_tokens,
       count(*) filter (where s.extract_model = m.model or s.reteach_model = m.model) as calls,
       m.input_per_mtok, m.output_per_mtok
from public.model_pricing m
left join public.scans s on (s.extract_model = m.model or s.reteach_model = m.model)
  and s.created_at >= (select start from period)
where m.active
group by m.model, m.input_per_mtok, m.output_per_mtok
order by calls desc;

-- Ticket queue with the teacher attached
create or replace view public.admin_tickets as
select t.id, t.ticket_ref, t.subject, t.category, t.status, t.priority, t.deflected,
       t.ai_confidence, t.created_at, t.updated_at, t.resolved_at,
       u.email as teacher_email, p.full_name as teacher_name, t.teacher_id,
       (select count(*) from public.support_messages m where m.ticket_id = t.id) as message_count,
       (select body from public.support_messages m where m.ticket_id = t.id order by created_at desc limit 1) as last_message
from public.support_tickets t
join auth.users u on u.id = t.teacher_id
left join public.profiles p on p.id = t.teacher_id;

-- Standards coverage by jurisdiction / subject / grade
create or replace view public.admin_standards_coverage as
select jurisdiction, framework, subject, grade,
       count(*) as standards,
       count(*) filter (where embedding is not null) as embedded,
       count(*) filter (where active) as active
from public.standards where teacher_id is null
group by 1,2,3,4 order by 1,2,3,4;

-- Reteaching library health
create or replace view public.admin_reteaching as
select r.id, r.title, r.error_pattern_key, r.error_pattern_label, r.grade_band,
       s.code as standard_code, s.subject, s.grade,
       r.review_status, r.quality_score, r.times_served, r.generation_cost_usd, r.model,
       r.created_at, r.updated_at
from public.reteaching_library r
join public.standards s on s.id = r.standard_id;

-- Lock all of it to the service role
revoke all on public.admin_accounts, public.admin_platform_stats, public.admin_daily_usage,
              public.admin_model_costs, public.admin_tickets, public.admin_standards_coverage,
              public.admin_reteaching
  from public, anon, authenticated;
