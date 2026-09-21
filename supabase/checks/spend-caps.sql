-- Not a migration. Safe to run against production: every write happens inside
-- a DO block that raises at the end, so the whole thing rolls back and nothing
-- it creates survives.
--
-- The spend ceilings are the last thing standing between a bug and a bill, and
-- they live almost entirely in SQL, which the JS harness cannot reach. The
-- Pacific-day boundary in particular is the kind of thing that looks right in
-- every test written in UTC and is wrong for seven hours a day in real life.
--
-- Every check asks spend_gate for its answer. Two of them used to compute the
-- total with a side query of their own, which meant they were checking the
-- arithmetic rather than the function: had the gate stopped counting, its own
-- sum and the check's private one would have disagreed and the check would
-- still have passed. A proof that never reads the thing it is proving is not a
-- proof.
--
-- Same style as supabase/checks/page-charges.sql. Paste the whole file into
-- the Supabase SQL editor. It raises one notice per check and then fails
-- deliberately with 'ROLLBACK: N of 9 checks passed'. Nine is a pass;
-- anything less names what broke in the same message.
--
-- It builds its own teachers and its own scans, so it never reads or changes a
-- real teacher's rows. It does temporarily move the platform cap and turn off
-- enable_seqscan for one EXPLAIN, which is why the rollback matters.

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
  v_node    text;
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
  -- 5. ...but the same spend still counts toward the platform total,
  --    and the gate is what we ask. Exemption decides whose budget it
  --    comes out of, never whether the money was spent.
  --
  --    For an exempt caller spend_gate reports the platform total as
  --    spent_usd, so this reads the number the gate itself would block
  --    on. Summing the scans here instead would prove only that sum()
  --    works.
  -- ===============================================================
  select * into v_g from public.spend_gate(v_admin, true);
  if v_g.spent_usd >= v_cap + 1 then
    v_pass := v_pass + 1;
    raise notice 'PASS 5  the gate counts exempt spend toward the platform total';
  else
    v_fail := v_fail || format('5: gate reports platform total %s, want at least %s',
      coalesce(v_g.spent_usd::text, 'null'), v_cap + 1);
  end if;

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

    -- Ask the gate. A sum written out here would agree with itself
    -- perfectly while the gate quietly counted a UTC day, which is the
    -- one failure this check exists to catch.
    select * into v_g from public.spend_gate(v_free);

    -- Only the 00:30 one is today. The 23:30 one belongs to yesterday.
    if v_g.spent_usd = 0.20 then
      v_pass := v_pass + 1;
      raise notice 'PASS 7  23:30 Pacific counts to that day, 00:30 to the next';
    else
      v_fail := v_fail || format('7: the gate counted %s today (want 0.20)',
        coalesce(v_g.spent_usd::text, 'null'));
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

  -- ===============================================================
  -- 9. The platform sum is served by an index.
  --    It used to filter on (created_at at time zone '...')::date =
  --    today, which is computed per row, so no index could serve it and
  --    EXPLAIN chose a sequential scan over the whole cost log even with
  --    enable_seqscan = off -- there was no other plan to choose. This
  --    runs before every grading request, so that was every request
  --    reading every scan ever made.
  --
  --    enable_seqscan = off is the point of the check, not a trick to
  --    make it pass: with it off the planner takes any index plan that
  --    exists, so a sequential scan here means there is none, which is
  --    exactly the state we are trying not to return to quietly.
  -- ===============================================================
  declare
    v_from timestamptz := (v_today::timestamp)       at time zone 'America/Los_Angeles';
    v_to   timestamptz := ((v_today + 1)::timestamp) at time zone 'America/Los_Angeles';
    v_line text;
    v_plan text := '';
  begin
    -- set local, so it is undone by the rollback as well as by the reset.
    set local enable_seqscan = off;
    for v_line in execute format(
      'explain select coalesce(sum(s.cost_usd), 0) from public.scans s '
      'where s.created_at >= %L and s.created_at < %L', v_from, v_to)
    loop
      v_plan := v_plan || v_line || E'\n';
      if v_node is null and v_line like '%Scan%' then
        v_node := btrim(v_line);
      end if;
    end loop;
    reset enable_seqscan;

    -- 'Index Scan' also matches 'Bitmap Index Scan', which is equally
    -- fine; what must not appear is a Seq Scan.
    if strpos(v_plan, 'Index Scan') > 0 and strpos(v_plan, 'Seq Scan') = 0 then
      v_pass := v_pass + 1;
      raise notice 'PASS 9  the platform sum uses an index: %', v_node;
    else
      v_fail := v_fail || format('9: plan is %s', coalesce(v_node, 'unreadable'));
    end if;
  end;

  -- ---------------------------------------------------------------
  -- Report, then roll the whole thing back.
  -- ---------------------------------------------------------------
  raise exception 'ROLLBACK: % of 9 checks passed | platform sum plan: % | %',
    v_pass,
    coalesce(v_node, '(not measured)'),
    case when array_length(v_fail, 1) is null then 'no failures'
         else 'FAILURES: ' || array_to_string(v_fail, ' | ') end;
end;
$$;
