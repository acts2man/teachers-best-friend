-- The first version of this put period_window() in the UPDATE's FROM clause
-- with the target table as its arguments, which Postgres rejects at runtime,
-- not at creation. A scheduled job is exactly where that hides: cron records
-- the run, the failure lands in a log nobody reads, and the periods quietly
-- never move. Compute the new windows in a subquery and join on teacher_id.
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
     set current_period_start = n.period_start,
         current_period_end   = n.period_end,
         updated_at           = now()
    from (
      select t.teacher_id, w.period_start, w.period_end
        from public.subscriptions t
        cross join lateral public.period_window(
          t.current_period_start, t.current_period_end, current_date) w
       where t.stripe_subscription_id is null
         and t.current_period_end <= current_date
    ) n
   where n.teacher_id = s.teacher_id
     and (n.period_start, n.period_end)
         is distinct from (s.current_period_start, s.current_period_end);
  get diagnostics v_rolled = row_count;
  return v_rolled;
end;
$$;

comment on function public.roll_expired_billing_periods() is
  'Advances lapsed billing windows on subscriptions Stripe does not manage. Scheduled nightly; enforcement does not depend on it.';

revoke execute on function public.roll_expired_billing_periods() from public, anon, authenticated;
