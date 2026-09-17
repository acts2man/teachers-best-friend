-- "Standards seeded" now means shared standards available to every teacher,
-- not only the subset that carries a vector embedding.
create or replace view public.admin_platform_stats as
with period as (select date_trunc('month', now()) as start, date_trunc('month', now()) + interval '1 mon' as "end")
select
  (select count(*) from profiles where status = 'active') as teachers_total,
  (select count(*) from profiles p join auth.users u on u.id = p.id where coalesce(p.last_seen_at, u.last_sign_in_at) >= now() - interval '7 days') as teachers_active_7d,
  (select count(*) from profiles p join auth.users u on u.id = p.id where coalesce(p.last_seen_at, u.last_sign_in_at) >= now() - interval '30 days') as teachers_active_30d,
  (select count(*) from auth.users where created_at >= now() - interval '7 days') as signups_7d,
  (select count(*) from subscriptions s join plans p on p.id = s.plan_id where p.price_cents > 0 and s.status = 'active') as paying_teachers,
  (select coalesce(sum(p.price_cents), 0)::numeric / 100.0 from subscriptions s join plans p on p.id = s.plan_id where s.status = 'active') as mrr_usd,
  (select count(*) from scans where created_at >= current_date) as scans_today,
  (select count(*) from scans, period where scans.created_at >= period.start and scans.created_at < period."end") as scans_this_month,
  (select coalesce(sum(cost_usd), 0) from scans, period where scans.created_at >= period.start and scans.created_at < period."end") as ai_cost_this_month,
  (select coalesce(avg(cost_usd), 0) from scans, period where scans.created_at >= period.start and scans.created_at < period."end" and scans.status = 'complete') as avg_cost_per_scan,
  (select round(100.0 * sum(library_hits)::numeric / nullif(sum(library_hits) + sum(library_misses), 0)::numeric, 1) from scans, period where scans.created_at >= period.start and scans.created_at < period."end") as cache_hit_rate_pct,
  (select count(*) from scans where status = 'failed' and created_at >= now() - interval '24 hours') as failed_scans_24h,
  (select count(*) from support_tickets where status in ('open', 'escalated')) as open_tickets,
  (select count(*) from reteaching_library where review_status = 'auto') as reteaching_unreviewed,
  (select count(*) from reteaching_library where review_status <> 'retired') as reteaching_entries,
  (select count(*) from standards where teacher_id is null and active) as standards_seeded,
  (select coalesce(sum(size_bytes), 0) from uploads where purged_at is null) as storage_bytes_total,
  (select count(*) from uploads where purged_at is null and expires_at <= now() + interval '7 days') as uploads_expiring_7d;
revoke all on public.admin_platform_stats from public, anon, authenticated;
grant select on public.admin_platform_stats to service_role;
