-- Which ceiling, if any, is stopping this teacher right now.
--
-- One call, made by the analyze route before anything is charged and before
-- the model is touched, so a blocked request costs nothing at all -- no page
-- charge to unwind, no model call to pay for.
--
-- A "day" here is the calendar day in America/Los_Angeles, not UTC. The
-- founders and both pilot teachers are on Pacific time, and a cap that reset
-- at 5pm local would be indefensible to explain. Postgres stores created_at as
-- timestamptz, so `at time zone 'America/Los_Angeles'` converts the instant to
-- wall-clock Pacific, and ::date takes the calendar day from that. This
-- handles daylight saving on its own, which is the reason not to do the
-- arithmetic by hand with a fixed offset.
create or replace function public.spend_gate(
  p_teacher uuid,
  p_exempt boolean default false
)
returns table (
  blocked boolean,
  reason text,
  cap_usd numeric,
  spent_usd numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today          date := (now() at time zone 'America/Los_Angeles')::date;
  v_platform_cap   numeric;
  v_platform_spent numeric;
  v_teacher_cap    numeric;
  v_teacher_spent  numeric;
begin
  select value into v_platform_cap
    from public.platform_settings where key = 'daily_platform_cost_cap_usd';

  -- The platform total counts everything, including the scans an admin is
  -- exempt from on their own cap. Exemption is about whose budget it comes
  -- out of, never about whether the money was spent.
  select coalesce(sum(s.cost_usd), 0) into v_platform_spent
    from public.scans s
   where (s.created_at at time zone 'America/Los_Angeles')::date = v_today;

  if v_platform_cap is not null and v_platform_spent >= v_platform_cap then
    return query select true, 'platform'::text, v_platform_cap, v_platform_spent;
    return;
  end if;

  -- Admin catalog loads unlock standards into a library every teacher shares,
  -- so they are not the admin's own usage. They still counted above.
  if p_exempt then
    return query select false, null::text, v_platform_cap, v_platform_spent;
    return;
  end if;

  select p.daily_cost_cap_usd into v_teacher_cap
    from public.subscriptions sub
    join public.plans p on p.id = sub.plan_id
   where sub.teacher_id = p_teacher;

  if v_teacher_cap is null then
    -- No plan, or a plan with no cap (beta). Nothing more to check.
    return query select false, null::text, null::numeric, null::numeric;
    return;
  end if;

  select coalesce(sum(s.cost_usd), 0) into v_teacher_spent
    from public.scans s
   where s.teacher_id = p_teacher
     and (s.created_at at time zone 'America/Los_Angeles')::date = v_today;

  if v_teacher_spent >= v_teacher_cap then
    return query select true, 'teacher'::text, v_teacher_cap, v_teacher_spent;
    return;
  end if;

  return query select false, null::text, v_teacher_cap, v_teacher_spent;
end;
$$;

comment on function public.spend_gate(uuid, boolean) is
  'Whether a spend ceiling blocks this teacher right now, in Pacific calendar days. Platform cap first (it stops everyone), then the teacher''s own unless exempt. Admin catalog loads are exempt from the teacher cap but always counted toward the platform total.';

-- One place an alert is filed, so adding Sentry later is one edit here rather
-- than a hunt through the routes.
--
-- p_dedupe_key is what keeps a condition from filing an alert per request: a
-- teacher who hits their cap at nine in the morning files one alert, not one
-- for every time they press Grade for the rest of the day. Passing null means
-- "always record this".
create or replace function public.record_platform_alert(
  p_kind text,
  p_message text,
  p_detail jsonb default null,
  p_dedupe_key text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  insert into public.platform_alerts (kind, message, detail, dedupe_key)
  values (p_kind, p_message, p_detail, p_dedupe_key)
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.record_platform_alert(text, text, jsonb, text) is
  'Files an operator alert. Returns null when a dedupe key has already been used, which is a no-op and not an error. The single place to add Sentry later.';

create or replace function public.acknowledge_platform_alert(p_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_hit int;
begin
  update public.platform_alerts
     set acknowledged_at = now()
   where id = p_id and acknowledged_at is null;
  get diagnostics v_hit = row_count;
  return v_hit > 0;
end;
$$;

revoke execute on function public.spend_gate(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.record_platform_alert(text, text, jsonb, text) from public, anon, authenticated;
revoke execute on function public.acknowledge_platform_alert(uuid) from public, anon, authenticated;
grant execute on function public.spend_gate(uuid, boolean) to service_role;
grant execute on function public.record_platform_alert(text, text, jsonb, text) to service_role;
grant execute on function public.acknowledge_platform_alert(uuid) to service_role;
