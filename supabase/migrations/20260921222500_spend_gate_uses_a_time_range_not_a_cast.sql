-- spend_gate summed today's spend with
--   (created_at at time zone 'America/Los_Angeles')::date = today
-- which no index can serve: the value compared is computed per row. EXPLAIN
-- with enable_seqscan = off still chose a sequential scan of public.scans,
-- because there was no other plan. The function runs before every grading
-- request, so at scale every request re-read the whole cost log.
--
-- Same Pacific day, expressed as the half-open instant range between two
-- Pacific midnights. date::timestamp at time zone 'X' yields the absolute
-- instant of that local midnight, so the DST changeover days (23 and 25
-- hours long) are measured correctly rather than assumed to be 24.

create index if not exists scans_created_at_idx
  on public.scans using btree (created_at);

create or replace function public.spend_gate(p_teacher uuid, p_exempt boolean default false)
returns table(blocked boolean, reason text, cap_usd numeric, spent_usd numeric)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_today          date := (now() at time zone 'America/Los_Angeles')::date;
  v_from           timestamptz := (v_today::timestamp)     at time zone 'America/Los_Angeles';
  v_to             timestamptz := ((v_today + 1)::timestamp) at time zone 'America/Los_Angeles';
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
   where s.created_at >= v_from
     and s.created_at <  v_to;

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

  -- Served by scans_teacher_recent_idx (teacher_id, created_at desc).
  select coalesce(sum(s.cost_usd), 0) into v_teacher_spent
    from public.scans s
   where s.teacher_id = p_teacher
     and s.created_at >= v_from
     and s.created_at <  v_to;

  if v_teacher_spent >= v_teacher_cap then
    return query select true, 'teacher'::text, v_teacher_cap, v_teacher_spent;
    return;
  end if;

  return query select false, null::text, v_teacher_cap, v_teacher_spent;
end;
$function$;
