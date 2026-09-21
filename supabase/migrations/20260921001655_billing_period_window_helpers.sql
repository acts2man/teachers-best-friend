-- Billing periods never moved.
--
-- Every subscription row was written once, at signup, with a one-month window
-- and nothing anywhere advanced it. current_period_scan_count only counts
-- scans inside that stored window, so the day the window ends the count reads
-- zero and keeps reading zero: quota enforcement stops, silently, while the
-- app looks fine. Every row on this project ends 2026-10-01.
--
-- period_window is the pure arithmetic, separated out so it can be tested
-- against any pair of dates without touching a subscription. It returns the
-- stored window unchanged while that window is still current -- which is the
-- case Stripe will own once billing exists -- and otherwise steps forward in
-- whole periods until it contains the given day.

create or replace function public.period_window(
  p_start date,
  p_end   date,
  p_on    date default current_date
)
returns table (period_start date, period_end date)
language plpgsql
stable
set search_path = public
as $$
declare
  v_len   int;
  v_steps int;
  v_start date;
begin
  -- Nothing sensible to compute from: hand back what was given.
  if p_start is null or p_end is null or p_end <= p_start then
    period_start := p_start; period_end := p_end; return next; return;
  end if;

  -- Still inside the stored window. This is the path a Stripe-managed
  -- subscription takes every time, so the webhook stays the only writer.
  if p_on < p_end then
    period_start := p_start; period_end := p_end; return next; return;
  end if;

  -- Length of the period in whole months. Anything shorter than a month
  -- (a trial, a partial first period) rolls on a monthly cadence.
  v_len := (date_part('year', age(p_end, p_start)) * 12
          + date_part('month', age(p_end, p_start)))::int;
  if v_len < 1 then v_len := 1; end if;

  v_steps := ((date_part('year', age(p_on, p_start)) * 12
             + date_part('month', age(p_on, p_start)))::int) / v_len;
  v_start := (p_start + (v_steps * v_len) * interval '1 month')::date;

  -- age() truncates, so the estimate can land one period short. Walk it
  -- forward until the window genuinely contains p_on.
  while (v_start + (v_len * interval '1 month'))::date <= p_on loop
    v_start := (v_start + (v_len * interval '1 month'))::date;
  end loop;

  period_start := v_start;
  period_end   := (v_start + (v_len * interval '1 month'))::date;
  return next;
end;
$$;

comment on function public.period_window(date, date, date) is
  'Pure arithmetic: the billing window containing p_on, stepping forward from a stored window in whole periods. Returns the stored window untouched while it is still current.';

-- The same thing for one teacher, reading their stored window.
create or replace function public.effective_period(p_teacher uuid default auth.uid())
returns table (period_start date, period_end date)
language sql
stable
security definer
set search_path = public
as $$
  select w.period_start, w.period_end
    from public.subscriptions s
    cross join lateral public.period_window(
      s.current_period_start, s.current_period_end, current_date) w
   where s.teacher_id = p_teacher;
$$;

comment on function public.effective_period(uuid) is
  'The billing window a teacher is actually in today, whether or not the stored dates have been rolled forward yet.';

revoke execute on function public.period_window(date, date, date) from public, anon;
revoke execute on function public.effective_period(uuid) from public, anon;
grant execute on function public.effective_period(uuid) to authenticated;
