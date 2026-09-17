-- Audit fix, part 4: restore the sample classroom on accounts that lost it.
--
-- Every account has a "The Explorers" class, created by the tbf_15 backfill
-- on 2026-09-09, but the 24 fictional students that class exists to hold were
-- never carried across -- and is_demo landed as false, so the SAMPLE CLASSROOM
-- label was gone too. The result: every teacher opened an empty demo class,
-- and Overview, Class insights, Students and grouping all had nothing to show.
--
-- Strictly additive. Nothing is deleted or overwritten:
--   * is_demo is set only on a 'demo' class that still has no students of its
--     own, so a class a teacher has started using as their own is left alone.
--   * Students and evidence are inserted only where the demo class is empty,
--     and ON CONFLICT DO NOTHING keeps this re-runnable.
--
-- Teachers can still delete the demo class once they have their own; that is
-- the intended path off it, not this migration's business.

do $$
declare
  v_template jsonb;
  v_students int := 0;
  v_evidence int := 0;
  d int;
begin
  select data into v_template from public.demo_templates where active order by created_at limit 1;
  if v_template is null then
    raise notice 'No active demo template; nothing to backfill.';
    return;
  end if;

  -- Only untouched demo classes: legacy_id 'demo' and not one student on it.
  create temporary table _target on commit drop as
    select c.id as class_id, c.teacher_id
      from public.classes c
     where c.legacy_id = 'demo'
       and not exists (select 1 from public.students s where s.class_id = c.id);

  update public.classes c
     set is_demo = true
    from _target t
   where c.id = t.class_id and c.is_demo is distinct from true;

  insert into public.students
    (teacher_id, legacy_id, legacy_class_id, class_id, display_label, color, notes)
  select t.teacher_id, s->>'id', 'demo', t.class_id,
         coalesce(nullif(s->>'name',''), 'Student'),
         s->>'color',
         nullif(s->>'notes','')
    from _target t
    cross join lateral jsonb_array_elements(coalesce(v_template->'students','[]'::jsonb)) s
   where s->>'id' is not null
  on conflict (teacher_id, legacy_id) where legacy_id is not null do nothing;
  get diagnostics d = row_count; v_students := d;

  insert into public.student_evidence
    (teacher_id, legacy_id, student_id, standard_code, score, source, recorded_on)
  select t.teacher_id, e->>'id', st.id,
         nullif(e->>'standard',''),
         public.safe_numeric(e->>'score'),
         nullif(e->>'source',''),
         coalesce(public.safe_date(e->>'date'), current_date)
    from _target t
    cross join lateral jsonb_array_elements(coalesce(v_template->'students','[]'::jsonb)) s
    join public.students st
      on st.teacher_id = t.teacher_id and st.legacy_id = s->>'id'
    cross join lateral jsonb_array_elements(coalesce(s->'evidence','[]'::jsonb)) e
   where e->>'id' is not null
  on conflict (teacher_id, legacy_id) where legacy_id is not null do nothing;
  get diagnostics d = row_count; v_evidence := d;

  -- Point each reseeded account at the sample classroom if it has no active
  -- class selected, so the app opens on something rather than nothing.
  update public.teacher_workspaces w
     set data = jsonb_set(coalesce(w.data,'{}'::jsonb), '{activeClassId}', '"demo"'::jsonb, true),
         revision = w.revision + 1
    from _target t
   where w.owner_id = t.teacher_id
     and coalesce(w.data->>'activeClassId','') = '';

  raise notice 'Backfilled % students and % evidence rows across % classes',
    v_students, v_evidence, (select count(*) from _target);
end $$;

