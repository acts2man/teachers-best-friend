-- Count against the window the teacher is actually in today, not the one
-- written at signup.
--
-- create_scan, my_scan_quota and scan_quota_status all delegate their counting
-- here, so this one function is the whole read-side fix. Verified against live
-- data before the swap: every teacher's count is identical today, because
-- today still falls inside the stored window. The difference only appears once
-- that window ends -- which is the bug.
create or replace function public.current_period_scan_count(p_teacher uuid default auth.uid())
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with w as (select * from public.effective_period(p_teacher))
  select count(*)::int
    from public.scans s, w
   where s.teacher_id = p_teacher
     and s.billable
     and s.status <> 'failed'
     and s.created_at >= w.period_start
     and s.created_at <  w.period_end;
$$;

comment on function public.current_period_scan_count(uuid) is
  'Billable, non-failed scans inside the teacher''s current window. Uses effective_period, so an unrolled stored window cannot silently zero the count.';

-- Keep the stored dates honest too.
--
-- Enforcement no longer depends on this -- effective_period covers the gap
-- between runs -- but the admin views read current_period_start/end directly,
-- and a dashboard showing "scans this period" against a window that ended in
-- March is its own kind of wrong.
--
-- Rows with a stripe_subscription_id are skipped on purpose: once billing
-- exists, the webhook is the only thing that should move a paid period.
create or replace function public.roll_expired_billing_periods()
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_rolled int;
begin
  update public.subscriptions s
     set current_period_start = w.period_start,
         current_period_end   = w.period_end,
         updated_at           = now()
    from public.period_window(s.current_period_start, s.current_period_end, current_date) w
   where s.stripe_subscription_id is null
     and s.current_period_end <= current_date
     and (w.period_start, w.period_end)
         is distinct from (s.current_period_start, s.current_period_end);
  get diagnostics v_rolled = row_count;
  return v_rolled;
end;
$$;

comment on function public.roll_expired_billing_periods() is
  'Advances lapsed billing windows on subscriptions Stripe does not manage. Scheduled nightly; enforcement does not depend on it.';

revoke execute on function public.roll_expired_billing_periods() from public, anon, authenticated;
