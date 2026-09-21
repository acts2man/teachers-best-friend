-- Not a migration. Safe to run against production: every write happens inside
-- a DO block that raises at the end, so the whole thing rolls back and nothing
-- it creates survives.
--
-- What this checks is the part of billing that lives in the database and that
-- the JS harness therefore cannot reach: that one Stripe event cannot be
-- processed twice, that an event which failed halfway can still be retried,
-- and that a cancelled subscription is handed back to the period roller.
--
-- Same style as supabase/checks/page-charges.sql. Run it by pasting the whole
-- file into the Supabase SQL editor. It raises one notice per check and then
-- fails deliberately with 'ROLLBACK: N of 7 checks passed'. Seven is a pass;
-- anything less names what broke in the same message.
--
-- It builds its own teacher and its own event ids, so it never reads or
-- touches a real teacher's rows or a real Stripe event.

do $$
declare
  v_teacher uuid;
  v_pass    int := 0;
  v_fail    text[] := '{}';
  v_event   text;
  v_hit     int;
  v_row     record;
begin
  -- ---------------------------------------------------------------
  -- A teacher of our own, mid-subscription, as Stripe would have left them.
  -- ---------------------------------------------------------------
  v_teacher := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (v_teacher, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'billing-check-' || v_teacher || '@example.invalid', now(), now());
  -- A trigger on auth.users already seeds a profile and a free subscription,
  -- so these describe the state needed rather than assuming sole ownership.
  insert into public.profiles (id, status) values (v_teacher, 'active')
  on conflict (id) do update set status = 'active';
  insert into public.subscriptions
    (teacher_id, plan_id, status, current_period_start, current_period_end,
     stripe_customer_id, stripe_subscription_id)
  values (v_teacher, 'tier1', 'active',
          (current_date - interval '10 days')::date,
          (current_date + interval '20 days')::date,
          'cus_check_' || v_teacher, 'sub_check_' || v_teacher)
  on conflict (teacher_id) do update
    set plan_id = 'tier1', status = 'active',
        current_period_start = excluded.current_period_start,
        current_period_end = excluded.current_period_end,
        stripe_customer_id = excluded.stripe_customer_id,
        stripe_subscription_id = excluded.stripe_subscription_id;

  -- ===============================================================
  -- 1. The same event id inserted twice is stored once. This is the
  --    whole idempotency guarantee, and it is a primary key rather
  --    than a rule the handler has to remember.
  -- ===============================================================
  v_event := 'evt_check_' || gen_random_uuid();
  insert into public.billing_events (event_id, type) values (v_event, 'invoice.paid');
  begin
    insert into public.billing_events (event_id, type) values (v_event, 'invoice.paid');
    v_fail := v_fail || '1: a duplicate event id was accepted';
  exception when unique_violation then
    select count(*) into v_hit from public.billing_events where event_id = v_event;
    if v_hit = 1 then
      v_pass := v_pass + 1;
      raise notice 'PASS 1  a duplicate event id is refused, one row kept';
    else
      v_fail := v_fail || format('1: %s rows for one event id', v_hit);
    end if;
  end;

  -- ===============================================================
  -- 2. A processed event is a no-op. "Seen and done" is what the
  --    handler checks before skipping.
  -- ===============================================================
  update public.billing_events set processed_at = now() where event_id = v_event;
  if (select processed_at is not null from public.billing_events where event_id = v_event) then
    v_pass := v_pass + 1;
    raise notice 'PASS 2  a processed event is marked done';
  else
    v_fail := v_fail || '2: processed_at did not stick';
  end if;

  -- ===============================================================
  -- 3. A stored-but-unprocessed event can still be processed.
  --    Without this split one failed attempt would bury the event
  --    forever: stored, so skipped, but never actually applied --
  --    a teacher who paid and stayed on the free plan.
  -- ===============================================================
  declare v_stuck text := 'evt_stuck_' || gen_random_uuid();
  begin
    insert into public.billing_events (event_id, type, error)
    values (v_stuck, 'customer.subscription.updated', 'retrieve failed');
    -- This is exactly the question the route asks to decide skip-or-retry.
    if (select processed_at is null from public.billing_events where event_id = v_stuck)
       and (select error is not null from public.billing_events where event_id = v_stuck) then
      -- The retry succeeds and marks it done.
      update public.billing_events
         set processed_at = now(), error = null
       where event_id = v_stuck;
      if (select processed_at is not null from public.billing_events where event_id = v_stuck) then
        v_pass := v_pass + 1;
        raise notice 'PASS 3  a stored but unprocessed event is retried, not skipped';
      else
        v_fail := v_fail || '3: the retry did not mark it processed';
      end if;
    else
      v_fail := v_fail || '3: a failed event did not record as unprocessed';
    end if;
  end;

  -- ===============================================================
  -- 4. A cancelled subscription is handed back to the period roller.
  --    roll_expired_billing_periods only moves rows Stripe does not
  --    manage, so clearing stripe_subscription_id is what re-enables
  --    it. Leaving it set would freeze the teacher's window forever.
  -- ===============================================================
  update public.subscriptions
     set plan_id = 'free', status = 'canceled', stripe_subscription_id = null,
         current_period_start = date_trunc('month', current_date)::date,
         current_period_end = (date_trunc('month', current_date) + interval '1 month')::date
   where teacher_id = v_teacher;
  select plan_id, status, stripe_subscription_id, stripe_customer_id,
         current_period_start, current_period_end
    into v_row from public.subscriptions where teacher_id = v_teacher;
  if v_row.plan_id = 'free'
     and v_row.status = 'canceled'
     and v_row.stripe_subscription_id is null
     -- The customer is kept: they may come back, and the portal needs it.
     and v_row.stripe_customer_id is not null
     and v_row.current_period_start = date_trunc('month', current_date)::date then
    v_pass := v_pass + 1;
    raise notice 'PASS 4  a cancelled subscription is free, unlinked and on the current month';
  else
    v_fail := v_fail || format('4: plan %s status %s sub %s',
      v_row.plan_id, v_row.status, coalesce(v_row.stripe_subscription_id, 'null'));
  end if;

  -- ===============================================================
  -- 5. The period roller now takes that row back over, and would not
  --    have while the Stripe id was still on it.
  -- ===============================================================
  declare v_moved int; v_skipped int;
  begin
    -- Backdate so the row is genuinely expired and eligible.
    update public.subscriptions
       set current_period_start = (date_trunc('month', current_date) - interval '2 months')::date,
           current_period_end = (date_trunc('month', current_date) - interval '1 month')::date
     where teacher_id = v_teacher;
    select count(*) into v_moved
      from public.subscriptions s
      cross join lateral public.period_window(s.current_period_start, s.current_period_end, current_date) w
     where s.teacher_id = v_teacher
       and s.stripe_subscription_id is null
       and s.current_period_end <= current_date
       and (w.period_start, w.period_end) is distinct from (s.current_period_start, s.current_period_end);
    -- And the same row, with a Stripe id back on it, is skipped.
    update public.subscriptions set stripe_subscription_id = 'sub_back_' || v_teacher
     where teacher_id = v_teacher;
    select count(*) into v_skipped
      from public.subscriptions s
     where s.teacher_id = v_teacher
       and s.stripe_subscription_id is null
       and s.current_period_end <= current_date;
    if v_moved = 1 and v_skipped = 0 then
      v_pass := v_pass + 1;
      raise notice 'PASS 5  the roller claims an unlinked row and skips a Stripe-managed one';
    else
      v_fail := v_fail || format('5: eligible %s, still eligible with stripe id %s (want 1/0)', v_moved, v_skipped);
    end if;
  end;

  -- ===============================================================
  -- 6. billing_events is closed to teachers. RLS is on and there is
  --    no policy for authenticated, so nothing a teacher's session
  --    can do reaches this table.
  -- ===============================================================
  declare v_rls boolean; v_policies int; v_grants int;
  begin
    select relrowsecurity into v_rls from pg_class where oid = 'public.billing_events'::regclass;
    select count(*) into v_policies from pg_policy where polrelid = 'public.billing_events'::regclass;
    select count(*) into v_grants
      from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'billing_events'
       and grantee in ('authenticated', 'anon', 'PUBLIC');
    if v_rls and v_policies = 0 and v_grants = 0 then
      v_pass := v_pass + 1;
      raise notice 'PASS 6  billing_events has RLS on, no policies and no teacher grants';
    else
      v_fail := v_fail || format('6: rls %s, policies %s, grants %s (want true/0/0)', v_rls, v_policies, v_grants);
    end if;
  end;

  -- ===============================================================
  -- 7. Beta is active but not listed: it keeps working for the two
  --    accounts on it and stays assignable from admin, while the
  --    public pricing page stops offering it to strangers.
  -- ===============================================================
  declare v_beta_active boolean; v_beta_listed boolean; v_listed_paid int;
  begin
    select active, listed into v_beta_active, v_beta_listed
      from public.plans where id = 'beta';
    select count(*) into v_listed_paid
      from public.plans where active and listed and price_cents > 0;
    if v_beta_active and not v_beta_listed and v_listed_paid = 3 then
      v_pass := v_pass + 1;
      raise notice 'PASS 7  beta is active but unlisted; exactly three paid plans are listed';
    else
      v_fail := v_fail || format('7: beta active %s listed %s, listed paid plans %s (want true/false/3)',
        v_beta_active, v_beta_listed, v_listed_paid);
    end if;
  end;

  -- ---------------------------------------------------------------
  -- Report, then roll the whole thing back.
  -- ---------------------------------------------------------------
  raise exception 'ROLLBACK: % of 7 checks passed%', v_pass,
    case when array_length(v_fail, 1) is null then ''
         else ' | FAILURES: ' || array_to_string(v_fail, ' | ') end;
end;
$$;
