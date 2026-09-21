-- "Scans this period" on the accounts overview counted billable rows in
-- public.scans, which is model calls, not pages. A pilot teacher reading that
-- number next to their own meter would have seen two different answers to the
-- same question. It now reads the same ledger the meter does, through the same
-- function, so admin and teacher cannot disagree.
--
-- Cast to bigint because the column was count(*) and CREATE OR REPLACE VIEW
-- will not change an existing column's type.
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
  public.current_period_scan_count(u.id)::bigint                                                        as scans_this_period,
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
  (select coalesce(avg(sc.cost_usd), 0) from public.scans sc
     where sc.teacher_id = u.id and sc.billable and sc.status = 'complete')                             as avg_cost_per_scan,
  (select coalesce(avg(sc.cost_usd), 0) from public.scans sc
     where sc.teacher_id = u.id and sc.billable and sc.status = 'complete'
       and sc.created_at >= now() - interval '30 days')                                                 as avg_cost_per_scan_30d
from auth.users u
join public.profiles p             on p.id = u.id
left join public.subscriptions sub on sub.teacher_id = u.id
left join public.plans pl          on pl.id = sub.plan_id;

-- CREATE OR REPLACE VIEW does not carry reloptions forward and restores the
-- default grants, so re-assert both (see 20260915013908).
alter view public.admin_accounts set (security_invoker = off);
revoke all on public.admin_accounts from public, anon, authenticated;
grant select on public.admin_accounts to service_role;
