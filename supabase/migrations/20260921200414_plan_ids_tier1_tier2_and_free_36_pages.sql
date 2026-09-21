-- Plan ids catch up with what the plans are called.
--
-- 'pro' has been named "Tier 1" and 'elite' "Tier 2" for a while, so the id and
-- the label disagreed everywhere they appeared together -- including the
-- signup link, /signup?plan=pro, which a teacher sees. Prices and quotas are
-- unchanged and were confirmed against this table before anything was touched:
-- tier1 1999/500, tier2 2999/1000, tier3 3999/1500.
--
-- Free goes from 20 to 36. Under the page ledger a scan is a page, and 36
-- pages is a full class set, which is what the free plan is meant to let a
-- teacher try.

update public.plans set scan_quota = 36 where id = 'free';

insert into public.plans (id, name, price_cents, scan_quota, overage_cents_per_100, seat_based, sort_order, active)
select 'tier1', name, price_cents, scan_quota, overage_cents_per_100, seat_based, sort_order, active
  from public.plans where id = 'pro'
on conflict (id) do nothing;

insert into public.plans (id, name, price_cents, scan_quota, overage_cents_per_100, seat_based, sort_order, active)
select 'tier2', name, price_cents, scan_quota, overage_cents_per_100, seat_based, sort_order, active
  from public.plans where id = 'elite'
on conflict (id) do nothing;

update public.subscriptions set plan_id = 'tier1' where plan_id = 'pro';
update public.subscriptions set plan_id = 'tier2' where plan_id = 'elite';

-- Delete the old ids only if nothing points at them. A plan row that is still
-- referenced is deactivated instead, so the rename can never orphan a
-- subscription.
delete from public.plans p
 where p.id in ('pro', 'elite')
   and not exists (select 1 from public.subscriptions s where s.plan_id = p.id);
update public.plans set active = false where id in ('pro', 'elite');

-- Not sold. Left in place rather than deleted: nothing is on them today, but a
-- deleted plan id in an old signup link becomes a broken page rather than a
-- plan that is simply not offered.
update public.plans set active = false where id in ('starter', 'team');
