create or replace view public.admin_accounts as
 SELECT u.id AS teacher_id,
    u.email,
    p.full_name,
    p.school_name,
    p.district,
    p.is_admin,
    p.status,
    p.status_reason,
    sub.plan_id,
    pl.name AS plan_name,
    pl.price_cents,
    pl.scan_quota,
    u.created_at AS signed_up_at,
    COALESCE(p.last_seen_at, u.last_sign_in_at) AS last_seen_at,
    ( SELECT count(*) AS count
           FROM classes c
          WHERE ((c.teacher_id = u.id) AND (c.archived_at IS NULL))) AS classes,
    ( SELECT count(*) AS count
           FROM students s
          WHERE ((s.teacher_id = u.id) AND (s.archived_at IS NULL))) AS students,
    ( SELECT count(*) AS count
           FROM assessments a
          WHERE ((a.teacher_id = u.id) AND (a.archived_at IS NULL))) AS assessments,
    ( SELECT count(*) AS count
           FROM uploads up
          WHERE ((up.teacher_id = u.id) AND (up.purged_at IS NULL))) AS uploads,
    ( SELECT COALESCE(sum(up.size_bytes), (0)::bigint) AS "coalesce"
           FROM uploads up
          WHERE ((up.teacher_id = u.id) AND (up.purged_at IS NULL))) AS storage_bytes,
    ( SELECT count(*) AS count
           FROM scans sc
          WHERE ((sc.teacher_id = u.id) AND sc.billable AND (sc.created_at >= sub.current_period_start) AND (sc.created_at < sub.current_period_end))) AS scans_this_period,
    ( SELECT count(*) AS count
           FROM scans sc
          WHERE (sc.teacher_id = u.id)) AS scans_lifetime,
    ( SELECT COALESCE(sum(sc.cost_usd), (0)::numeric) AS "coalesce"
           FROM scans sc
          WHERE ((sc.teacher_id = u.id) AND (sc.created_at >= sub.current_period_start) AND (sc.created_at < sub.current_period_end))) AS ai_cost_this_period,
    ( SELECT COALESCE(sum(sc.cost_usd), (0)::numeric) AS "coalesce"
           FROM scans sc
          WHERE (sc.teacher_id = u.id)) AS ai_cost_lifetime,
    ( SELECT max(sc.created_at) AS max
           FROM scans sc
          WHERE (sc.teacher_id = u.id)) AS last_scan_at,
    ( SELECT count(*) AS count
           FROM support_tickets t
          WHERE ((t.teacher_id = u.id) AND (t.status = ANY (ARRAY['open'::text, 'escalated'::text])))) AS open_tickets,
    sub.current_period_start,
    sub.current_period_end,
    sub.stripe_customer_id,
    p.is_app_manager
   FROM ((auth.users u
     JOIN profiles p ON ((p.id = u.id)))
     LEFT JOIN subscriptions sub ON ((sub.teacher_id = u.id)))
     LEFT JOIN plans pl ON ((pl.id = sub.plan_id));

