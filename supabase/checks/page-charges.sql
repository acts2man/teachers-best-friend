-- Not a migration. Safe to run against production: every write happens inside
-- a DO block that raises at the end, so the whole thing rolls back and nothing
-- it creates survives.
--
-- The JS test harness has no database, and the rule this file checks -- one
-- scan is one page, and a page is never charged twice -- lives almost entirely
-- in SQL. The parts that are JavaScript (page counting, which modes charge,
-- the wording on the button) are covered by tests/page-metering.test.mjs.
--
-- How to run it: paste the whole file into the Supabase SQL editor on the
-- Teachers Best Friend project and execute. It raises one notice per check and
-- then fails deliberately with 'ROLLBACK: N of 13 checks passed' -- thirteen
-- because check 1 has two halves, the bodies and the strips, and the strips
-- are the half that would double the bill if it ever regressed. Anything less
-- than thirteen names the checks that broke in the same message.
--
-- It builds its own teacher, plan, subscription and uploads, so it never reads
-- or touches a real teacher's rows.

do $$
declare
  v_teacher  uuid;
  v_other    uuid;
  v_pass     int := 0;
  v_fail     text[] := '{}';
  v_body     uuid[] := '{}';
  v_strip    uuid[] := '{}';
  v_r        record;
  v_used     int;
  v_msg      text;
  i          int;
begin
  -- ---------------------------------------------------------------
  -- A teacher of our own, on a 36-page plan, inside a current window.
  -- ---------------------------------------------------------------
  v_teacher := gen_random_uuid();
  v_other   := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (v_teacher, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'ledger-check-' || v_teacher || '@example.invalid', now(), now()),
         (v_other, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'ledger-other-' || v_other || '@example.invalid', now(), now());
  -- A trigger on auth.users already seeds a profile and a free subscription
  -- for a new account, so these are upserts: the check has to describe the
  -- state it needs, not assume it is the only writer.
  insert into public.profiles (id, status) values (v_teacher, 'active'), (v_other, 'active')
  on conflict (id) do update set status = 'active';
  insert into public.subscriptions (teacher_id, plan_id, status, current_period_start, current_period_end)
  values (v_teacher, 'free', 'active', date_trunc('month', current_date)::date,
          (date_trunc('month', current_date) + interval '1 month')::date),
         (v_other, 'free', 'active', date_trunc('month', current_date)::date,
          (date_trunc('month', current_date) + interval '1 month')::date)
  on conflict (teacher_id) do update
    set plan_id = 'free', status = 'active',
        current_period_start = excluded.current_period_start,
        current_period_end = excluded.current_period_end;

  -- Thirty papers, each photographed once and cut in two: a body upload and a
  -- name-strip upload, exactly as components/teacher-class-scan.tsx does it.
  for i in 1..30 loop
    v_body  := v_body  || gen_random_uuid();
    v_strip := v_strip || gen_random_uuid();
    insert into public.teacher_uploads (id, owner_id, name, object_path, mime, size, page_count, content_sha256)
    values (v_body[i],  v_teacher, 'body ' || i,  'x/' || v_body[i],  'image/jpeg', 1000, 1, 'body-'  || i || '-' || v_teacher),
           (v_strip[i], v_teacher, 'strip ' || i, 'x/' || v_strip[i], 'image/jpeg', 200,  1, 'strip-' || i || '-' || v_teacher);
  end loop;

  -- ===============================================================
  -- 1. A class set of 30 pages, bodies and strips: exactly 30, strips 0.
  -- ===============================================================
  select * into v_r from public.charge_pages(v_teacher, v_body, 'class_scan');
  if v_r.charged = 30 and v_r.already_paid = 0 then
    v_pass := v_pass + 1;
    raise notice 'PASS  1  30 body pages charged 30';
  else
    v_fail := v_fail || format('1: charged %s, already_paid %s (want 30/0)', v_r.charged, v_r.already_paid);
  end if;

  -- The strips are the other half of pages already paid for. Charging per
  -- upload instead of per page would bill this class set twice.
  select * into v_r from public.charge_pages(v_teacher, v_strip, 'name_strip');
  if v_r.charged = 0 then
    v_pass := v_pass + 1;
    raise notice 'PASS  1b name strips charged 0';
  else
    v_fail := v_fail || format('1b: strips charged %s (want 0)', v_r.charged);
  end if;

  -- ===============================================================
  -- 2. The same class set graded again: nothing new.
  -- ===============================================================
  select * into v_r from public.charge_pages(v_teacher, v_body, 'class_scan');
  if v_r.charged = 0 and v_r.already_paid = 30 then
    v_pass := v_pass + 1;
    raise notice 'PASS  2  re-grade charged 0';
  else
    v_fail := v_fail || format('2: charged %s, already_paid %s (want 0/30)', v_r.charged, v_r.already_paid);
  end if;

  -- ===============================================================
  -- 3. A batch fails, its pages are released, the retry charges once.
  --    Total across the class set is still 30.
  -- ===============================================================
  perform public.release_pages(v_teacher, v_body[1:6]);
  select * into v_r from public.charge_pages(v_teacher, v_body[1:6], 'class_scan');
  v_used := public.current_period_scan_count(v_teacher);
  if v_r.charged = 6 and v_used = 30 then
    v_pass := v_pass + 1;
    raise notice 'PASS  3  released batch re-charged 6, total still 30';
  else
    v_fail := v_fail || format('3: retry charged %s, used %s (want 6/30)', v_r.charged, v_used);
  end if;

  -- ===============================================================
  -- 4. A page confirmed, then a later call on it fails: still charged.
  -- ===============================================================
  perform public.confirm_pages(v_teacher, v_body[1:6]);
  perform public.release_pages(v_teacher, v_body[1:6]);
  v_used := public.current_period_scan_count(v_teacher);
  if v_used = 30
     and (select count(*) from public.page_charges
           where teacher_id = v_teacher and released_at is not null) = 0 then
    v_pass := v_pass + 1;
    raise notice 'PASS  4  confirmed pages are not refunded by a later failure';
  else
    v_fail := v_fail || format('4: used %s after releasing confirmed pages (want 30)', v_used);
  end if;

  -- ===============================================================
  -- 5. Quota 36 with 36 pages: allowed, used = 36, and create_scan does
  --    NOT then refuse. This is the case that used to charge a teacher
  --    for the pages and then reject the scan.
  -- ===============================================================
  for i in 31..36 loop
    v_body := v_body || gen_random_uuid();
    insert into public.teacher_uploads (id, owner_id, name, object_path, mime, size, page_count, content_sha256)
    values (v_body[i], v_teacher, 'body ' || i, 'x/' || v_body[i], 'image/jpeg', 1000, 1, 'body-' || i || '-' || v_teacher);
  end loop;
  select * into v_r from public.charge_pages(v_teacher, v_body[31:36], 'class_scan');
  v_used := public.current_period_scan_count(v_teacher);
  begin
    perform public.create_scan(v_teacher, null, null, null, null, true, 'class_scan');
    if v_used = 36 and v_r.remaining = 0 then
      v_pass := v_pass + 1;
      raise notice 'PASS  5  exactly 36 of 36 allowed, create_scan still opens';
    else
      v_fail := v_fail || format('5: used %s remaining %s (want 36/0)', v_used, v_r.remaining);
    end if;
  exception when others then
    v_fail := v_fail || format('5: create_scan refused the last page: %s', sqlerrm);
  end;

  -- ===============================================================
  -- 6. 12 remaining, 30 pages submitted: refused, and NOTHING written.
  -- ===============================================================
  -- Start the second teacher at 24 of 36 so 12 are left.
  declare
    v_o_body uuid[] := '{}';
    v_before int;
    v_after  int;
  begin
    for i in 1..54 loop
      v_o_body := v_o_body || gen_random_uuid();
      insert into public.teacher_uploads (id, owner_id, name, object_path, mime, size, page_count, content_sha256)
      values (v_o_body[i], v_other, 'o ' || i, 'x/' || v_o_body[i], 'image/jpeg', 1000, 1, 'o-' || i || '-' || v_other);
    end loop;
    perform public.charge_pages(v_other, v_o_body[1:24], 'class_scan');
    select count(*) into v_before from public.page_charges where teacher_id = v_other;
    begin
      perform public.charge_pages(v_other, v_o_body[25:54], 'class_scan');
      v_fail := v_fail || '6: a 30-page stack was accepted with 12 left';
    exception when others then
      v_msg := sqlerrm;
      select count(*) into v_after from public.page_charges where teacher_id = v_other;
      if v_msg like '%SCAN_QUOTA_EXCEEDED%' and v_after = v_before then
        v_pass := v_pass + 1;
        raise notice 'PASS  6  30 pages with 12 left: refused, zero rows written';
      else
        v_fail := v_fail || format('6: %s, rows %s -> %s', v_msg, v_before, v_after);
      end if;
    end;
  end;

  -- ===============================================================
  -- 7. The same file bytes uploaded twice: two upload ids, one hash,
  --    charged once.
  -- ===============================================================
  declare
    v_a uuid := gen_random_uuid();
    v_b uuid := gen_random_uuid();
  begin
    insert into public.teacher_uploads (id, owner_id, name, object_path, mime, size, page_count, content_sha256)
    values (v_a, v_other, 'dup a', 'x/' || v_a, 'image/jpeg', 1000, 1, 'same-bytes-' || v_other),
           (v_b, v_other, 'dup b', 'x/' || v_b, 'image/jpeg', 1000, 1, 'same-bytes-' || v_other);
    select * into v_r from public.charge_pages(v_other, array[v_a, v_b], 'responses');
    if v_r.charged = 1 then
      v_pass := v_pass + 1;
      raise notice 'PASS  7  the same bytes twice charged once';
    else
      v_fail := v_fail || format('7: charged %s (want 1)', v_r.charged);
    end if;
  end;

  -- ===============================================================
  -- 8. A 5-page PDF is 5.
  -- ===============================================================
  declare v_pdf uuid := gen_random_uuid();
  begin
    insert into public.teacher_uploads (id, owner_id, name, object_path, mime, size, page_count, content_sha256)
    values (v_pdf, v_other, 'five.pdf', 'x/' || v_pdf, 'application/pdf', 5000, 5, 'pdf5-' || v_other);
    select * into v_r from public.charge_pages(v_other, array[v_pdf], 'assignment');
    if v_r.charged = 5 then
      v_pass := v_pass + 1;
      raise notice 'PASS  8  a 5-page PDF charged 5';
    else
      v_fail := v_fail || format('8: charged %s (want 5)', v_r.charged);
    end if;
  end;

  -- ===============================================================
  -- 9. name_strip and catalog charge 0; a generation with no upload
  --    charges 1.
  -- ===============================================================
  declare
    v_fresh uuid := gen_random_uuid();
    v_c1 int; v_c2 int; v_c3 int;
  begin
    insert into public.teacher_uploads (id, owner_id, name, object_path, mime, size, page_count, content_sha256)
    values (v_fresh, v_other, 'fresh', 'x/' || v_fresh, 'image/jpeg', 1000, 1, 'fresh-' || v_other);
    select charged into v_c1 from public.charge_pages(v_other, array[v_fresh], 'name_strip');
    select charged into v_c2 from public.charge_pages(v_other, array[v_fresh], 'catalog');
    select charged into v_c3 from public.charge_pages(v_other, '{}'::uuid[], 'lesson', 'gen:' || gen_random_uuid());
    if v_c1 = 0 and v_c2 = 0 and v_c3 = 1 then
      v_pass := v_pass + 1;
      raise notice 'PASS  9  name_strip 0, catalog 0, generated lesson 1';
    else
      v_fail := v_fail || format('9: name_strip %s, catalog %s, lesson %s (want 0/0/1)', v_c1, v_c2, v_c3);
    end if;
  end;

  -- ===============================================================
  -- 10. A reservation backdated three hours and never confirmed stops
  --     counting. This is what makes an abandoned stack free without a
  --     cron job.
  -- ===============================================================
  declare
    v_stale uuid := gen_random_uuid();
    v_was int;
    v_now int;
  begin
    insert into public.teacher_uploads (id, owner_id, name, object_path, mime, size, page_count, content_sha256)
    values (v_stale, v_teacher, 'stale', 'x/' || v_stale, 'image/jpeg', 1000, 1, 'stale-' || v_teacher);
    -- Charged against a teacher already at 36 would be refused, so give this
    -- one its own row by releasing a page first.
    perform public.release_pages(v_teacher, v_body[36:36]);
    perform public.charge_pages(v_teacher, array[v_stale], 'responses');
    v_was := public.current_period_scan_count(v_teacher);
    update public.page_charges
       set reserved_at = now() - interval '3 hours'
     where teacher_id = v_teacher and upload_id = v_stale;
    v_now := public.current_period_scan_count(v_teacher);
    if v_now = v_was - 1 then
      v_pass := v_pass + 1;
      raise notice 'PASS 10  an abandoned reservation stops counting after two hours';
    else
      v_fail := v_fail || format('10: %s -> %s (want a drop of 1)', v_was, v_now);
    end if;
  end;

  -- ===============================================================
  -- 11. A page charged in September and re-graded in October counts in
  --     September only, and charges nothing new in October.
  -- ===============================================================
  declare
    v_sep uuid := gen_random_uuid();
    v_third uuid := gen_random_uuid();
    v_in_sep int;
    v_in_oct int;
    v_new int;
  begin
    insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    values (v_third, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'ledger-sep-' || v_third || '@example.invalid', now(), now());
    insert into public.profiles (id, status) values (v_third, 'active')
    on conflict (id) do update set status = 'active';
    -- A window that started two months ago and was never rolled: effective_period
    -- steps it forward, so "this period" is the current month.
    insert into public.subscriptions (teacher_id, plan_id, status, current_period_start, current_period_end)
    values (v_third, 'free', 'active',
            (date_trunc('month', current_date) - interval '2 months')::date,
            (date_trunc('month', current_date) - interval '1 month')::date)
    on conflict (teacher_id) do update
      set current_period_start = excluded.current_period_start,
          current_period_end = excluded.current_period_end;
    insert into public.teacher_uploads (id, owner_id, name, object_path, mime, size, page_count, content_sha256)
    values (v_sep, v_third, 'sep page', 'x/' || v_sep, 'image/jpeg', 1000, 1, 'sep-' || v_third);
    perform public.charge_pages(v_third, array[v_sep], 'class_scan');
    perform public.confirm_pages(v_third, array[v_sep]);
    v_in_oct := public.current_period_scan_count(v_third);

    -- Backdate the charge into the previous window, which is what a page
    -- scanned last month looks like.
    update public.page_charges
       set reserved_at = (date_trunc('month', current_date) - interval '20 days')
     where teacher_id = v_third and upload_id = v_sep;
    v_in_sep := public.current_period_scan_count(v_third);
    select charged into v_new from public.charge_pages(v_third, array[v_sep], 'class_scan');
    if v_in_oct = 1 and v_in_sep = 0 and v_new = 0 then
      v_pass := v_pass + 1;
      raise notice 'PASS 11  last month''s page does not count this month, and re-grades free';
    else
      v_fail := v_fail || format('11: this period %s, after backdating %s, re-charge %s (want 1/0/0)',
                                 v_in_oct, v_in_sep, v_new);
    end if;
  end;

  -- ===============================================================
  -- 12. An upload belonging to another teacher is refused outright,
  --     rather than silently skipped.
  -- ===============================================================
  declare
    v_theirs uuid := gen_random_uuid();
    v_rows_before int;
    v_rows_after int;
  begin
    insert into public.teacher_uploads (id, owner_id, name, object_path, mime, size, page_count, content_sha256)
    values (v_theirs, v_other, 'not yours', 'x/' || v_theirs, 'image/jpeg', 1000, 1, 'theirs-' || v_other);
    select count(*) into v_rows_before from public.page_charges where teacher_id = v_teacher;
    begin
      perform public.charge_pages(v_teacher, array[v_theirs], 'responses');
      v_fail := v_fail || '12: another teacher''s upload was accepted';
    exception when others then
      v_msg := sqlerrm;
      select count(*) into v_rows_after from public.page_charges where teacher_id = v_teacher;
      if v_msg like '%UPLOAD_NOT_FOUND%' and v_rows_after = v_rows_before then
        v_pass := v_pass + 1;
        raise notice 'PASS 12  another teacher''s upload is refused, nothing written';
      else
        v_fail := v_fail || format('12: %s', v_msg);
      end if;
    end;
  end;

  -- ---------------------------------------------------------------
  -- Report, then roll the whole thing back.
  -- ---------------------------------------------------------------
  -- The failures ride on the exception as well as the notices, so this reads
  -- the same whether it is run in the SQL editor or through a client that
  -- shows the error and swallows the notices.
  raise exception 'ROLLBACK: % of 13 checks passed%', v_pass,
    case when array_length(v_fail, 1) is null then ''
         else ' | FAILURES: ' || array_to_string(v_fail, ' | ') end;
end;
$$;
