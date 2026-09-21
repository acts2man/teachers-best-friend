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
-- Check 9 is the same idea applied to the plan: it reads spend_gate's own body
-- back out of the database as well as EXPLAINing the sum, because an EXPLAIN of
-- a query written here proves what an index can do, not what the function asks
-- for.
--
-- It builds its own teachers and its own scans, so it never reads or changes a
-- real teacher's rows. It does temporarily move the platform cap and turn off
-- enable_seqscan for one EXPLAIN, which is why the rollback matters.
--
-- One honest limit: it adds about $6.70 of its own spend and several checks
-- need the platform total to stay under the 25.00 cap, so on a day when real
-- spend has already passed roughly $18 this file fails for reasons that are not
-- bugs. Check what the day's spend is before reading a failure here as proof of
-- anything.

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
  v_before  numeric;
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
  -- The platform total as the gate reports it BEFORE the exempt scan
  -- exists, so check 5 can assert what that one scan added.
  select spent_usd into v_before from public.spend_gate(v_admin, true);

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
  --    spent_usd, and v_g still holds check 4's reading -- taken after
  --    the insert. So this asserts the GROWTH across that insert rather
  --    than that the total cleared some floor.
  --
  --    The floor version of this check was worthless. `spent_usd >=
  --    v_cap + 1` is 1.50, and checks 1 to 3 had already put 5.51 on the
  --    board, so it passed whether or not the exempt scan was counted at
  --    all. Add `and s.billable` to the gate's platform sum -- a
  --    plausible "we should not bill ourselves for catalog runs" edit,
  --    and the scan above is deliberately billable = false -- and admin
  --    catalog spend silently stops counting toward the platform
  --    ceiling while all nine checks still report green.
  --
  --    >= rather than = because this runs against production: a real
  --    grading request landing between the two readings adds to the
  --    growth. It cannot subtract from it, so the direction that would
  --    hide a bug is still exact.
  -- ===============================================================
  if v_g.spent_usd - v_before >= v_cap + 1 then
    v_pass := v_pass + 1;
    raise notice 'PASS 5  the exempt scan added % to the platform total the gate reports',
      v_g.spent_usd - v_before;
  else
    v_fail := v_fail || format('5: platform total went %s -> %s, a growth of %s, want at least %s',
      coalesce(v_before::text, 'null'),
      coalesce(v_g.spent_usd::text, 'null'),
      coalesce((v_g.spent_usd - v_before)::text, 'null'),
      v_cap + 1);
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
  -- 9. The platform sum is served by an index, and spend_gate is the
  --    thing that asks for it. Two halves, both required.
  --
  --    It used to filter on (created_at at time zone '...')::date =
  --    today, which is computed per row, so no index could serve it and
  --    EXPLAIN chose a sequential scan over the whole cost log even with
  --    enable_seqscan = off -- there was no other plan to choose. This
  --    runs before every grading request, so that was every request
  --    reading every scan ever made.
  --
  --    (a) The plan. enable_seqscan = off is the point of the check, not
  --    a trick to make it pass: with it off the planner takes any index
  --    plan that exists, so a sequential scan here means there is none.
  --
  --    (b) The function. The EXPLAIN above runs a query written in this
  --    file, not the one inside spend_gate. Revert the function to the
  --    cast while leaving scans_created_at_idx in place and (a) goes on
  --    passing happily: it proves the index can serve that shape, not
  --    that the gate uses it. That is the same side-query weakness
  --    checks 5 and 7 had, one level up, so the function's own body is
  --    read back with pg_get_functiondef and required to have no per-row
  --    cast of created_at and to bound it on both sides with the range
  --    variables.
  --
  --    Proved able to fail rather than assumed: the same three
  --    predicates run against the old body -- statements[1] of migration
  --    20260921215639 -- return false, false, false.
  -- ===============================================================
  declare
    v_from timestamptz := (v_today::timestamp)       at time zone 'America/Los_Angeles';
    v_to   timestamptz := ((v_today + 1)::timestamp) at time zone 'America/Los_Angeles';
    v_line    text;
    v_plan    text := '';
    v_def     text;
    v_plan_ok boolean;
    v_body_ok boolean;
  begin
    -- (a) -------------------------------------------------------
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

    -- Name the index. public.scans carries nine indexes, its primary
    -- key among them, and with enable_seqscan = off the planner will
    -- gladly take any of them -- a full scan of scans_pkey reads as an
    -- "Index Scan" while telling us nothing, so drop
    -- scans_created_at_idx and a check that only forbade Seq Scan would
    -- go on passing. Matching the name also lets a Bitmap Index Scan or
    -- an Index Only Scan through, which are both fine.
    v_plan_ok := strpos(v_plan, 'scans_created_at_idx') > 0
             and strpos(v_plan, 'Seq Scan') = 0;

    -- (b) -------------------------------------------------------
    -- The body as the database currently holds it, not as a migration
    -- file once described it.
    v_def := pg_get_functiondef('public.spend_gate'::regproc);
    v_body_ok := v_def !~* 'created_at at time zone'
             and v_def ~*  'created_at\s*>=\s*v_from'
             and v_def ~*  'created_at\s*<\s*v_to';

    if v_plan_ok and v_body_ok then
      v_pass := v_pass + 1;
      raise notice 'PASS 9  spend_gate filters on the range, and the plan is %', v_node;
    else
      v_fail := v_fail || format('9: plan %s (%s), body %s',
        case when v_plan_ok then 'ok' else 'NOT using scans_created_at_idx' end,
        coalesce(v_node, 'unreadable'),
        case when v_body_ok then 'ok'
             else 'casts created_at per row, or no longer bounds it by v_from/v_to' end);
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
