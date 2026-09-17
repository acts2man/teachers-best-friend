-- Same correction as admin_accounts: the two storage figures on the overview
-- dashboard were counting the legacy uploads table the app no longer writes to.
create or replace view public.admin_platform_stats as
 WITH period AS (
         SELECT date_trunc('month'::text, now()) AS start,
            (date_trunc('month'::text, now()) + '1 mon'::interval) AS "end"
        )
 SELECT ( SELECT count(*) AS count
           FROM profiles
          WHERE (profiles.status = 'active'::text)) AS teachers_total,
    ( SELECT count(*) AS count
           FROM (profiles p
             JOIN auth.users u ON ((u.id = p.id)))
          WHERE (COALESCE(p.last_seen_at, u.last_sign_in_at) >= (now() - '7 days'::interval))) AS teachers_active_7d,
    ( SELECT count(*) AS count
           FROM (profiles p
             JOIN auth.users u ON ((u.id = p.id)))
          WHERE (COALESCE(p.last_seen_at, u.last_sign_in_at) >= (now() - '30 days'::interval))) AS teachers_active_30d,
    ( SELECT count(*) AS count
           FROM auth.users
          WHERE (users.created_at >= (now() - '7 days'::interval))) AS signups_7d,
    ( SELECT count(*) AS count
           FROM (subscriptions s
             JOIN plans p ON ((p.id = s.plan_id)))
          WHERE ((p.price_cents > 0) AND (s.status = 'active'::text))) AS paying_teachers,
    ( SELECT ((COALESCE(sum(p.price_cents), (0)::bigint))::numeric / 100.0)
           FROM (subscriptions s
             JOIN plans p ON ((p.id = s.plan_id)))
          WHERE (s.status = 'active'::text)) AS mrr_usd,
    ( SELECT count(*) AS count
           FROM scans
          WHERE (scans.created_at >= CURRENT_DATE)) AS scans_today,
    ( SELECT count(*) AS count
           FROM scans,
            period
          WHERE ((scans.created_at >= period.start) AND (scans.created_at < period."end"))) AS scans_this_month,
    ( SELECT COALESCE(sum(scans.cost_usd), (0)::numeric) AS "coalesce"
           FROM scans,
            period
          WHERE ((scans.created_at >= period.start) AND (scans.created_at < period."end"))) AS ai_cost_this_month,
    ( SELECT COALESCE(avg(scans.cost_usd), (0)::numeric) AS "coalesce"
           FROM scans,
            period
          WHERE ((scans.created_at >= period.start) AND (scans.created_at < period."end") AND (scans.status = 'complete'::scan_status))) AS avg_cost_per_scan,
    ( SELECT round(((100.0 * (sum(scans.library_hits))::numeric) / (NULLIF((sum(scans.library_hits) + sum(scans.library_misses)), 0))::numeric), 1) AS round
           FROM scans,
            period
          WHERE ((scans.created_at >= period.start) AND (scans.created_at < period."end"))) AS cache_hit_rate_pct,
    ( SELECT count(*) AS count
           FROM scans
          WHERE ((scans.status = 'failed'::scan_status) AND (scans.created_at >= (now() - '24:00:00'::interval)))) AS failed_scans_24h,
    ( SELECT count(*) AS count
           FROM support_tickets
          WHERE (support_tickets.status = ANY (ARRAY['open'::text, 'escalated'::text]))) AS open_tickets,
    ( SELECT count(*) AS count
           FROM reteaching_library
          WHERE (reteaching_library.review_status = 'auto'::text)) AS reteaching_unreviewed,
    ( SELECT count(*) AS count
           FROM reteaching_library
          WHERE (reteaching_library.review_status <> 'retired'::text)) AS reteaching_entries,
    ( SELECT count(*) AS count
           FROM standards
          WHERE ((standards.teacher_id IS NULL) AND standards.active)) AS standards_seeded,
    ( SELECT COALESCE(sum(teacher_uploads.size), (0)::bigint) AS "coalesce"
           FROM teacher_uploads
          WHERE (teacher_uploads.purged_at IS NULL)) AS storage_bytes_total,
    ( SELECT count(*) AS count
           FROM teacher_uploads
          WHERE ((teacher_uploads.purged_at IS NULL) AND (teacher_uploads.expires_at <= (now() + '7 days'::interval)))) AS uploads_expiring_7d;

