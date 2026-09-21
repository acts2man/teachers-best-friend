-- Not a migration. Safe to run against production: every write happens inside
-- a DO block that raises at the end, so the whole thing rolls back and nothing
-- it creates survives.
--
-- Two promises are checked here, and both are promises made in public.
--
-- content/legal/dpa.md Section 7: "A teacher may delete any student, class,
-- assessment, or their whole account at any time from within the Service."
-- Deleting an account has to actually empty every table, and the only way to
-- know that is to build a teacher with a row in each one and look afterwards.
--
-- The retention table in the same document: "Grading results held for
-- delivery: cleared 48 hours after the scan." Forty-eight is a number, and a
-- number is either right on both sides of the boundary or it is decoration.
--
-- Check 3 is the one that will still be working in a year. It reads every
-- foreign key in the database that points at auth.users and asserts the
-- deleted teacher appears in none of them, so a table added later is covered
-- by this file the day it is created rather than the day someone remembers.
-- It runs BEFORE the auth user is deleted, on purpose: run it after, and the
-- ON DELETE CASCADE would have tidied up a table the deletion function forgot,
-- and the check would pass while the function stayed broken.
--
-- Checks 5, 8, 10 and 12 all say the same thing in different places: that
-- moving a scan row does not move the money on it. They are there because a
-- BEFORE UPDATE trigger used to re-derive cost_usd from the token columns on
-- any service-role write, so unlinking a teacher or clearing a payload
-- silently recomputed what the work had cost -- as zero, whenever the model
-- was no longer in the price list. Check 13 is the other half: the trigger
-- must still fire when its own inputs change, or recording usage would stop
-- costing anything at all.
--
-- Paste the whole file into the Supabase SQL editor. It raises one notice per
-- check and then fails deliberately with 'ROLLBACK: N of 13 checks passed'.
-- Thirteen is a pass; anything less names what broke in the same message.

do $$
declare
  v_a       uuid;   -- the teacher who asks to be deleted
  v_b       uuid;   -- a bystander, who must be untouched
  v_c       uuid;   -- deleted from auth.users with no cleanup, to test the FK
  v_pass    int := 0;
  v_fail    text[] := '{}';
  v_class   uuid;
  v_student uuid;
  v_ticket  uuid;
  v_scan_a  uuid;
  v_scan_c  uuid;
  v_cost    numeric;
  v_tokens  bigint;
  v_n       bigint;
  v_ref     record;
  v_leaks   text[] := '{}';
  v_result  jsonb;
  v_detail  jsonb;
begin
  -- ---------------------------------------------------------------
  -- Three teachers of our own.
  -- ---------------------------------------------------------------
  v_a := gen_random_uuid();
  v_b := gen_random_uuid();
  v_c := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (v_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'del-a-' || v_a || '@example.invalid', now(), now()),
         (v_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'del-b-' || v_b || '@example.invalid', now(), now()),
         (v_c, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'del-c-' || v_c || '@example.invalid', now(), now());

  -- A trigger already seeds a profile and a free subscription for a new
  -- account, so these describe the state needed rather than assuming
  -- sole ownership.
  insert into public.profiles (id, status) values (v_a, 'active'), (v_b, 'active'), (v_c, 'active')
  on conflict (id) do update set status = 'active';
  insert into public.subscriptions (teacher_id, plan_id, status)
  values (v_a, 'tier1', 'active'), (v_b, 'free', 'active'), (v_c, 'free', 'active')
  on conflict (teacher_id) do update set plan_id = excluded.plan_id, status = 'active';

  -- ---------------------------------------------------------------
  -- Teacher A gets one of everything.
  -- ---------------------------------------------------------------
  insert into public.teacher_workspaces (owner_id, data)
  values (v_a, '{"classes":[],"students":[]}'::jsonb);

  insert into public.classes (teacher_id, name, grade)
  values (v_a, 'Period 2 Math', 4) returning id into v_class;

  insert into public.students (teacher_id, class_id, display_label, notes)
  values (v_a, v_class, 'Ada', 'Works better with a number line') returning id into v_student;

  insert into public.student_evidence (teacher_id, student_id, standard_code, score, source)
  values (v_a, v_student, '4.OA.A.3', 80, 'Quiz');

  insert into public.lessons   (teacher_id, class_id, title) values (v_a, v_class, 'Bar diagrams');
  insert into public.resources (teacher_id, title, kind)     values (v_a, 'Number line poster', 'file');

  insert into public.support_tickets (teacher_id, subject, body)
  values (v_a, 'Blank answers', 'Two of my students came back blank') returning id into v_ticket;
  insert into public.support_messages (ticket_id, teacher_id, author, body)
  values (v_ticket, v_a, 'teacher', 'Here is what I photographed');

  insert into public.page_charges (teacher_id, content_sha256, pages, mode)
  values (v_a, repeat('a', 64), 3, 'responses');

  -- Upload rows in both the current table and the legacy one. Only the rows:
  -- the files they name can only be removed through the Storage API, which is
  -- the caller's half of this and cannot be reached from SQL -- a trigger on
  -- storage.objects raises on any direct delete, which is how the first
  -- version of delete_teacher_account was caught.
  insert into public.teacher_uploads (id, owner_id, name, object_path, mime, size)
  values (gen_random_uuid(), v_a, 'page1.jpg', v_a || '/page1.jpg', 'image/jpeg', 1024);
  insert into public.uploads (teacher_id, bucket_id, object_path, original_name, mime, size_bytes)
  values (v_a, 'teacher-documents', v_a || '/legacy.jpg', 'legacy.jpg', 'image/jpeg', 2048);

  -- A scan carrying a child's work, and a real cost we have already paid for.
  insert into public.scans (teacher_id, billable, status, stage, cost_usd, created_at,
                            extract_input_tokens, extract_output_tokens, params, result, error)
  values (v_a, true, 'complete', 'responses', 0.0897, now() - interval '3 days',
          1200, 340,
          '{"mode":"responses","studentId":"x"}'::jsonb,
          '{"responses":[{"answer":"144"}],"title":"Week 3"}'::jsonb,
          'openai poll 400: something about the request')
  returning id into v_scan_a;

  select cost_usd, extract_input_tokens + extract_output_tokens
    into v_cost, v_tokens from public.scans where id = v_scan_a;

  -- Teacher B, the bystander.
  insert into public.teacher_workspaces (owner_id, data) values (v_b, '{"classes":[]}'::jsonb);
  insert into public.classes (teacher_id, name, grade) values (v_b, 'Period 4 Reading', 5);
  insert into public.scans (teacher_id, billable, status, stage, cost_usd, params, result)
  values (v_b, true, 'complete', 'responses', 0.0100, '{"mode":"responses"}'::jsonb, '{"responses":[]}'::jsonb);

  -- ===============================================================
  -- 1. The fixture is real. A proof that deletes nothing proves nothing,
  --    so this fails loudly if the rows above did not land.
  -- ===============================================================
  if (select count(*) from public.students where teacher_id = v_a) = 1
     and (select count(*) from public.support_messages where teacher_id = v_a) = 1
     and (select count(*) from public.page_charges where teacher_id = v_a) = 1
     and (select count(*) from public.teacher_uploads where owner_id = v_a) = 1
     and (select count(*) from public.uploads where teacher_id = v_a) = 1
     and (select count(*) from public.scans where teacher_id = v_a) = 1 then
    v_pass := v_pass + 1;
    raise notice 'PASS 1  the account under test really has rows to delete';
  else
    v_fail := v_fail || ' 1: the fixture did not land'::text;
  end if;

  -- ===============================================================
  -- 2. The deletion runs and reports what it did.
  -- ===============================================================
  v_result := public.delete_teacher_account(v_a);
  if (v_result ->> 'plan') = 'tier1' and (v_result ->> 'scans_unlinked')::int = 1 then
    v_pass := v_pass + 1;
    raise notice 'PASS 2  the deletion reports the plan and the scans it unlinked';
  else
    v_fail := v_fail || format('2: returned %s', v_result);
  end if;

  -- ===============================================================
  -- 3. Nothing anywhere still references them.
  --    Every foreign key in the database that points at auth.users,
  --    read from the catalog rather than from a list someone has to
  --    remember to extend. Run now, while the auth user still exists,
  --    so a table the function forgot cannot be rescued by the cascade.
  -- ===============================================================
  for v_ref in
    select c.relname as tbl, a.attname as col
      from pg_constraint con
      join pg_class c        on c.oid = con.conrelid
      join pg_namespace n    on n.oid = c.relnamespace and n.nspname = 'public'
      join pg_attribute a    on a.attrelid = c.oid and a.attnum = con.conkey[1]
      join pg_class tc       on tc.oid = con.confrelid
      join pg_namespace tn   on tn.oid = tc.relnamespace
     where con.contype = 'f'
       and tc.relname = 'users' and tn.nspname = 'auth'
       and array_length(con.conkey, 1) = 1
     order by c.relname, a.attname
  loop
    execute format('select count(*) from public.%I where %I = $1', v_ref.tbl, v_ref.col)
      into v_n using v_a;
    if v_n > 0 then
      v_leaks := v_leaks || format('%s.%s=%s', v_ref.tbl, v_ref.col, v_n);
    end if;
  end loop;

  if array_length(v_leaks, 1) is null then
    v_pass := v_pass + 1;
    raise notice 'PASS 3  no table that references auth.users still names this teacher';
  else
    v_fail := v_fail || ('3: still referenced in ' || array_to_string(v_leaks, ', '));
  end if;

  -- ===============================================================
  -- 4. The cost log survived, unlinked and emptied.
  -- ===============================================================
  if exists (
    select 1 from public.scans
     where id = v_scan_a
       and teacher_id is null
       and params is null and result is null and error is null
  ) then
    v_pass := v_pass + 1;
    raise notice 'PASS 4  the scan survives with no teacher and no student work on it';
  else
    v_fail := v_fail || '4: the scan row is gone, still linked, or still carries a payload'::text;
  end if;

  -- ===============================================================
  -- 5. And it is still a financial record: the money and the tokens
  --    are exactly what they were.
  -- ===============================================================
  if exists (
    select 1 from public.scans
     where id = v_scan_a
       and cost_usd = v_cost
       and extract_input_tokens + extract_output_tokens = v_tokens
       and status = 'complete'
       and stage = 'responses'
  ) then
    v_pass := v_pass + 1;
    raise notice 'PASS 5  cost, tokens, status and stage are untouched';
  else
    v_fail := v_fail || format('5: cost or tokens changed (was %s / %s)', v_cost, v_tokens);
  end if;

  -- ===============================================================
  -- 6. One audit line, carrying no email and no name.
  -- ===============================================================
  select count(*) into v_n from public.admin_audit_log
   where action = 'delete_account' and target_id = v_a::text;
  select detail into v_detail from public.admin_audit_log
   where action = 'delete_account' and target_id = v_a::text limit 1;
  if v_n = 1
     and (select actor_email is null and actor_id is null from public.admin_audit_log
           where action = 'delete_account' and target_id = v_a::text limit 1)
     and (v_detail ->> 'plan') = 'tier1'
     and (v_detail ->> 'self_serve')::boolean
     -- Nothing in the detail looks like an address.
     and v_detail::text !~ '@' then
    v_pass := v_pass + 1;
    raise notice 'PASS 6  one audit line, no email, no name, plan recorded';
  else
    v_fail := v_fail || format('6: %s audit rows, detail %s', v_n, coalesce(v_detail::text, 'null'));
  end if;

  -- ===============================================================
  -- 7. Running it again finishes the job instead of erroring on what is
  --    already gone -- which is exactly what a resumed deletion does --
  --    and does not write a second audit line.
  -- ===============================================================
  v_result := public.delete_teacher_account(v_a);
  select count(*) into v_n from public.admin_audit_log
   where action = 'delete_account' and target_id = v_a::text;
  if v_n = 1 and (v_result ->> 'scans_unlinked')::int = 0 then
    v_pass := v_pass + 1;
    raise notice 'PASS 7  a second run is a no-op and writes no second audit line';
  else
    v_fail := v_fail || format('7: %s audit rows after a repeat run', v_n);
  end if;

  -- ===============================================================
  -- 8. The sign-in itself goes, and taking it does not take the cost
  --    log with it.
  -- ===============================================================
  delete from auth.users where id = v_a;
  if not exists (select 1 from auth.users where id = v_a)
     and exists (select 1 from public.scans where id = v_scan_a and cost_usd = v_cost) then
    v_pass := v_pass + 1;
    raise notice 'PASS 8  the auth user is gone and the scan is still there';
  else
    v_fail := v_fail || '8: the auth user survived, or the scan went with it'::text;
  end if;

  -- ===============================================================
  -- 9. The bystander is untouched. Every deletion is somebody else's
  --    near miss.
  -- ===============================================================
  if (select count(*) from public.classes where teacher_id = v_b) = 1
     and (select count(*) from public.teacher_workspaces where owner_id = v_b) = 1
     and (select count(*) from public.scans where teacher_id = v_b) = 1
     and (select count(*) from public.subscriptions where teacher_id = v_b) = 1
     and exists (select 1 from public.scans where teacher_id = v_b and result is not null) then
    v_pass := v_pass + 1;
    raise notice 'PASS 9  the other teacher still has everything, payload included';
  else
    v_fail := v_fail || '9: a second teacher lost rows'::text;
  end if;

  -- ===============================================================
  -- 10. The foreign key is SET NULL, not CASCADE.
  --     Teacher C is deleted straight out of auth.users with no cleanup
  --     at all -- what a hand in the Supabase dashboard does. The cost
  --     of the work we already paid for must not go with them.
  -- ===============================================================
  insert into public.scans (teacher_id, billable, status, stage, cost_usd)
  values (v_c, true, 'complete', 'responses', 0.0250) returning id into v_scan_c;
  delete from auth.users where id = v_c;
  if exists (select 1 from public.scans where id = v_scan_c and teacher_id is null and cost_usd = 0.0250) then
    v_pass := v_pass + 1;
    raise notice 'PASS 10  deleting an auth user by hand unlinks the cost log, it does not erase it';
  else
    v_fail := v_fail || '10: a bare auth.users delete destroyed the cost record'::text;
  end if;

  -- ===============================================================
  -- 11. Forty-eight hours, on both sides of the boundary.
  --     A rule tested only on the far side is a rule that would pass
  --     just as happily at twenty-four hours, or at one.
  -- ===============================================================
  declare
    v_47 uuid; v_49 uuid; v_cat uuid;
  begin
    insert into public.scans (teacher_id, billable, status, stage, cost_usd, created_at, params, result, error)
    values (v_b, true, 'complete', 'responses', 0.01, now() - interval '47 hours',
            '{"mode":"responses"}'::jsonb, '{"responses":[]}'::jsonb, 'openai poll 400: body')
    returning id into v_47;

    insert into public.scans (teacher_id, billable, status, stage, cost_usd, created_at,
                              extract_input_tokens, extract_output_tokens, params, result, error)
    values (v_b, true, 'complete', 'responses', 0.02, now() - interval '49 hours',
            900, 150,
            '{"mode":"responses"}'::jsonb, '{"responses":[{"answer":"144"}]}'::jsonb, 'openai poll 400: body')
    returning id into v_49;

    insert into public.scans (teacher_id, billable, status, stage, cost_usd, created_at, params, result)
    values (v_b, false, 'complete', 'catalog', 0.15, now() - interval '49 hours',
            '{"mode":"catalog"}'::jsonb, '{"standards":[{"code":"4.OA.A.3"}]}'::jsonb)
    returning id into v_cat;

    perform public.purge_scan_payloads();

    if (select params is not null and result is not null and error is not null
          from public.scans where id = v_47)
       and (select params is null and result is null and error is null
              from public.scans where id = v_49) then
      v_pass := v_pass + 1;
      raise notice 'PASS 11  47 hours is kept, 49 hours is cleared';
    else
      v_fail := v_fail || '11: the 48-hour boundary is not where it says it is'::text;
    end if;

    -- =============================================================
    -- 12. catalog is exempt, and clearing a payload does not touch the
    --     money. Both in one check because they are the same worry:
    --     that an UPDATE reached further than it was meant to.
    -- =============================================================
    if (select params is not null and result is not null from public.scans where id = v_cat)
       and (select cost_usd = 0.02
                and extract_input_tokens = 900 and extract_output_tokens = 150
                and status = 'complete'
              from public.scans where id = v_49) then
      v_pass := v_pass + 1;
      raise notice 'PASS 12  catalog keeps its payload, and the cleared row keeps its cost';
    else
      v_fail := v_fail || '12: catalog was cleared, or a cost column moved'::text;
    end if;
  end;

  -- ---------------------------------------------------------------
  -- Report, then roll the whole thing back.
  -- ---------------------------------------------------------------
  -- ===============================================================
  -- 13. ...and the cost trigger still works when it is supposed to.
  --     Narrowing it to fire only on its own inputs is worthless if it
  --     narrowed to never, which would quietly make every future scan
  --     free and the margin numbers fiction.
  -- ===============================================================
  declare
    v_model text;
    v_rate  numeric;
    v_scan  uuid;
    v_after numeric;
  begin
    select model, input_per_mtok into v_model, v_rate
      from public.model_pricing where active order by model limit 1;

    insert into public.scans (teacher_id, billable, status, stage, cost_usd,
                              extract_model, extract_input_tokens, extract_output_tokens)
    values (v_b, true, 'complete', 'responses', 0, v_model, 0, 0)
    returning id into v_scan;

    -- One million input tokens, so the expected cost is the per-million rate.
    update public.scans set extract_input_tokens = 1000000 where id = v_scan;
    select cost_usd into v_after from public.scans where id = v_scan;

    if v_after = round(v_rate, 6) then
      v_pass := v_pass + 1;
      raise notice 'PASS 13  changing the tokens still recomputes the cost (% -> %)', v_model, v_after;
    else
      v_fail := v_fail || format('13: %s tokens priced at %s, got %s', v_model, v_rate, v_after);
    end if;
  end;

  raise exception 'ROLLBACK: % of 13 checks passed | %', v_pass,
    case when array_length(v_fail, 1) is null then 'no failures'
         else 'FAILURES: ' || array_to_string(v_fail, ' | ') end;
end;
$$;
