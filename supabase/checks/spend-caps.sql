-- Not a migration. Safe to run against production: every write happens inside
-- a DO block that raises at the end, so the whole thing rolls back and nothing
-- it creates survives.
--
-- The spend ceilings are the last thing standing between a bug and a bill, and
-- they live almost entirely in SQL, which the JS harness cannot reach. The
-- Pacific-day boundary in particular is the kind of thing that looks right in
-- every test written in UTC and is wrong for seven hours a day in real life.
--
-- Same style as supabase/checks/page-charges.sql. Paste the whole file into
-- the Supabase SQL editor. It raises one notice per check and then fails
-- deliberately with 'ROLLBACK: N of 8 checks passed'. Eight is a pass;
-- anything less names what broke in the same message.
--
-- It builds its own teachers and its own scans, so it never reads or changes a
-- real teacher's rows. It does temporarily move the platform cap, which is why
-- the rollback matters.

do $$
declare
  v_free    uuid;
  v_beta    uuid;
  v_admin   uuid;
  v_pass    int := 0;
  v_fail    text[] := '{}';
  v_g       record;
  v_today   date := (now() at time zone 'America/Los_Angeles')::date;
  v_cap     numeric;
begin
  -- ---------------------------------------------------------------
  -- Three teachers of our own: a capped one, an uncapped one, an admin.
  -- ---------------------------------------------------------------
  v_free  := gen_random_uuid();
  v_beta  := gen_random_uuid();
  v_admin := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (v_free,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cap-free-'  || v_free  || '@example.invalid', now(), now()),
         (v_beta,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cap-beta-'  || v_beta  || '@example.invalid', now(), now()),
         (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cap-admin-' || v_admin || '@example.invalid', now(), now());
  -- A trigger already seeds a profile and a free subscription for a new
  -- account, so these describe the state needed rather than assuming
  -- sole ownership.
  insert into public.profiles (id, status) values (v_free, 'active'), (v_beta, 'active'), (v_admin, 'active')
  on conflict (id) do update set status = 'active';
  insert into public.subscriptions (teacher_id, plan_id, status)
  values (v_free, 'free', 'active'), (v_beta, 'beta', 'active'), (v_admin, 'free', 'active')
  on conflict (teacher_id) do update set plan_id = excluded.plan_id, status = 'active';

  select daily_cost_cap_usd into v_cap from public.plans where id = 'free';

  -- ===============================================================
  -- 1. Under the cap: allowed.
  -- ===============================================================
  insert into public.scans (teacher_id, billable, status, stage, cost_usd, created_at)
  values (v_free, true, 'complete', 'responses', 0.01, now());
  select * into v_g from public.spend_gate(v_free);
  if not v_g.blocked and v_g.cap_usd = v_cap then
    v_pass := v_pass + 1;
    raise notice 'PASS 1  a teacher well under the cap is allowed';
  else
    v_fail := v_fail || format('1: blocked %s reason %s', v_g.blocked, coalesce(v_g.reason, 'null'));
  end if;

  -- ===============================================================
  -- 2. Over the per-teacher cap: blocked, and named as the teacher's.
  -- ===============================================================
  insert into public.scans (teacher_id, billable, status, stage, cost_usd, created_at)
  values (v_free, true, 'complete', 'responses', v_cap, now());
  select * into v_g from public.spend_gate(v_free);
  if v_g.blocked and v_g.reason = 'teacher' then
    v_pass := v_pass + 1;
    raise notice 'PASS 2  over the daily cap is blocked as a teacher cap';
  else
    v_fail := v_fail || format('2: blocked %s reason %s spent %s', v_g.blocked, coalesce(v_g.reason, 'null'), v_g.spent_usd);
  end if;

  -- ===============================================================
  -- 3. Beta has no cap and is never blocked by one, however much it spends.
  -- ===============================================================
  insert into public.scans (teacher_id, billable, status, stage, cost_usd, created_at)
  values (v_beta, true, 'complete', 'class_scan', 5.00, now());
  select * into v_g from public.spend_gate(v_beta);
  if not v_g.blocked and v_g.cap_usd is null then
    v_pass := v_pass + 1;
    raise notice 'PASS 3  an uncapped plan is never blocked by a teacher cap';
  else
    v_fail := v_fail || format('3: blocked %s cap %s', v_g.blocked, coalesce(v_g.cap_usd::text, 'null'));
  end if;

  -- ===============================================================
  -- 4. An admin is exempt from the teacher cap.
  --    Catalog runs unlock standards into a library every teacher shares,
  --    so that spend is not the admin's own usage.
  -- ===============================================================
  insert into public.scans (teacher_id, billable, status, stage, cost_usd, created_at)
  values (v_admin, false, 'complete', 'catalog', v_cap + 1, now());
  select * into v_g from public.spend_gate(v_admin, true);
  if not v_g.blocked then
    v_pass := v_pass + 1;
    raise notice 'PASS 4  an exempt caller is not blocked by the teacher cap';
  else
    v_fail := v_fail || format('4: exempt caller blocked: %s', coalesce(v_g.reason, 'null'));
  end if;

  -- ===============================================================
  -- 5. ...but the same spend still counts toward the platform total.
  --    Exemption decides whose budget it comes out of, never whether
  --    the money was spent.
  -- ===============================================================
  declare v_platform_spent numeric;
  begin
    select coalesce(sum(s.cost_usd), 0) into v_platform_spent
      from public.scans s
     where (s.created_at at time zone 'America/Los_Angeles')::date = v_today;
    if v_platform_spent >= v_cap + 1 then
      v_pass := v_pass + 1;
      raise notice 'PASS 5  exempt spend still counts toward the platform total';
    else
      v_fail := v_fail || format('5: platform total %s does not include the exempt scan', v_platform_spent);
    end if;
  end;

  -- ===============================================================
  -- 6. The platform cap blocks everyone, including uncapped beta and
  --    including an exempt admin. It is checked first for that reason.
  -- ===============================================================
  declare v_beta_g record; v_admin_g record;
  begin
    update public.platform_settings set value = 0.01
     where key = 'daily_platform_cost_cap_usd';
    select * into v_g       from public.spend_gate(v_free);
    select * into v_beta_g  from public.spend_gate(v_beta);
    select * into v_admin_g from public.spend_gate(v_admin, true);
    if v_g.blocked and v_g.reason = 'platform'
       and v_beta_g.blocked and v_beta_g.reason = 'platform'
       and v_admin_g.blocked and v_admin_g.reason = 'platform' then
      v_pass := v_pass + 1;
      raise notice 'PASS 6  the platform cap stops every teacher, exempt or uncapped';
    else
      v_fail := v_fail || format('6: free %s beta %s admin %s',
        coalesce(v_g.reason, 'null'), coalesce(v_beta_g.reason, 'null'), coalesce(v_admin_g.reason, 'null'));
    end if;
    -- Put it back before anything else runs. The rollback would do this
    -- anyway; not relying on that keeps the later checks honest.
    update public.platform_settings set value = 25.00
     where key = 'daily_platform_cost_cap_usd';
  end;

  -- ===============================================================
  -- 7. The day boundary is Pacific, not UTC.
  --    A scan at 23:30 Pacific counts toward that day; one at 00:30
  --    the next morning does not. In UTC both of those are the same
  --    calendar day for seven hours of every day, which is how a cap
  --    silently carries yesterday's spend into today.
  -- ===============================================================
  declare
    v_late    timestamptz;
    v_early   timestamptz;
    v_counted numeric;
  begin
    -- 23:30 Pacific yesterday, and 00:30 Pacific today, expressed as real
    -- instants. Building them this way rather than with a fixed -07:00 is
    -- the point: the offset changes twice a year and this does not.
    v_late  := ((v_today - 1) + time '23:30') at time zone 'America/Los_Angeles';
    v_early := (v_today + time '00:30') at time zone 'America/Los_Angeles';

    delete from public.scans where teacher_id = v_free;
    insert into public.scans (teacher_id, billable, status, stage, cost_usd, created_at)
    values (v_free, true, 'complete', 'responses', 0.10, v_late),
           (v_free, true, 'complete', 'responses', 0.20, v_early);

    select coalesce(sum(s.cost_usd), 0) into v_counted
      from public.scans s
     where s.teacher_id = v_free
       and (s.created_at at time zone 'America/Los_Angeles')::date = v_today;

    -- Only the 00:30 one is today. The 23:30 one belongs to yesterday.
    if v_counted = 0.20 then
      v_pass := v_pass + 1;
      raise notice 'PASS 7  23:30 Pacific counts to that day, 00:30 to the next';
    else
      v_fail := v_fail || format('7: today counted %s (want 0.20)', v_counted);
    end if;
  end;

  -- ===============================================================
  -- 8. And the gate agrees with that arithmetic: yesterday's late-night
  --    spend does not eat into today's allowance.
  -- ===============================================================
  select * into v_g from public.spend_gate(v_free);
  if not v_g.blocked and v_g.spent_usd = 0.20 then
    v_pass := v_pass + 1;
    raise notice 'PASS 8  the gate counts only today''s Pacific spend';
  else
    v_fail := v_fail || format('8: blocked %s spent %s (want false/0.20)', v_g.blocked, v_g.spent_usd);
  end if;

  -- ---------------------------------------------------------------
  -- Report, then roll the whole thing back.
  -- ---------------------------------------------------------------
  raise exception 'ROLLBACK: % of 8 checks passed%', v_pass,
    case when array_length(v_fail, 1) is null then ''
         else ' | FAILURES: ' || array_to_string(v_fail, ' | ') end;
end;
$$;
