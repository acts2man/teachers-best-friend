-- ===============================================================
-- WRITE FACADE
-- Full reconcile of the client's workspace JSON into relational rows:
-- upsert everything by client id, then delete rows the client no
-- longer has. Replaces `update teacher_workspaces set data = $1` on
-- the PUT path. Idempotent. Supersedes migrate_workspace.
-- ===============================================================
create or replace function public.sync_workspace(p_teacher uuid, p_data jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  ids text[];
  n_del int := 0; d int;
begin
  ------------------------------------------------------------ classes
  insert into public.classes (teacher_id, legacy_id, name, grade, framework, color, is_demo)
  select p_teacher, c->>'id', coalesce(nullif(c->>'name',''),'Untitled class'),
         c->>'grade', c->>'framework', c->>'color', public.safe_bool(c->>'demo')
  from jsonb_array_elements(coalesce(p_data->'classes','[]'::jsonb)) c
  where c->>'id' is not null
  on conflict (teacher_id, legacy_id) where legacy_id is not null do update set
    name = excluded.name, grade = excluded.grade, framework = excluded.framework,
    color = excluded.color, is_demo = excluded.is_demo, archived_at = null, updated_at = now();

  select coalesce(array_agg(c->>'id'), '{}') into ids
    from jsonb_array_elements(coalesce(p_data->'classes','[]'::jsonb)) c;
  delete from public.classes where teacher_id = p_teacher and legacy_id is not null and not (legacy_id = any(ids));
  get diagnostics d = row_count; n_del := n_del + d;

  ------------------------------------------------------------ students
  insert into public.students (teacher_id, legacy_id, legacy_class_id, class_id, display_label, full_name, color, notes)
  select p_teacher, s->>'id', s->>'classId',
         (select cl.id from public.classes cl where cl.teacher_id = p_teacher and cl.legacy_id = s->>'classId'),
         coalesce(nullif(s->>'name',''), 'Student'),
         nullif(s->>'fullName',''), s->>'color', nullif(s->>'notes','')
  from jsonb_array_elements(coalesce(p_data->'students','[]'::jsonb)) s
  where s->>'id' is not null
  on conflict (teacher_id, legacy_id) where legacy_id is not null do update set
    legacy_class_id = excluded.legacy_class_id, class_id = excluded.class_id,
    display_label = excluded.display_label, full_name = excluded.full_name,
    color = excluded.color, notes = excluded.notes, archived_at = null, updated_at = now();

  select coalesce(array_agg(s->>'id'), '{}') into ids
    from jsonb_array_elements(coalesce(p_data->'students','[]'::jsonb)) s;
  delete from public.students where teacher_id = p_teacher and legacy_id is not null and not (legacy_id = any(ids));
  get diagnostics d = row_count; n_del := n_del + d;

  ------------------------------------------------------------ evidence (nested in students)
  insert into public.student_evidence (teacher_id, legacy_id, student_id, standard_code, assessment_id, score, source, recorded_on)
  select p_teacher, e->>'id', st.id, nullif(e->>'standard',''),
         (select a.id from public.assessments a where a.teacher_id = p_teacher and a.legacy_id = e->>'assessmentId'),
         public.safe_numeric(e->>'score'), nullif(e->>'source',''),
         coalesce(public.safe_date(e->>'date'), current_date)
  from jsonb_array_elements(coalesce(p_data->'students','[]'::jsonb)) s
  join public.students st on st.teacher_id = p_teacher and st.legacy_id = s->>'id'
  cross join lateral jsonb_array_elements(coalesce(s->'evidence','[]'::jsonb)) e
  where e->>'id' is not null
  on conflict (teacher_id, legacy_id) where legacy_id is not null do update set
    student_id = excluded.student_id, standard_code = excluded.standard_code,
    assessment_id = excluded.assessment_id, score = excluded.score,
    source = excluded.source, recorded_on = excluded.recorded_on;

  select coalesce(array_agg(e->>'id'), '{}') into ids
    from jsonb_array_elements(coalesce(p_data->'students','[]'::jsonb)) s,
         lateral jsonb_array_elements(coalesce(s->'evidence','[]'::jsonb)) e;
  delete from public.student_evidence where teacher_id = p_teacher and legacy_id is not null and not (legacy_id = any(ids));
  get diagnostics d = row_count; n_del := n_del + d;

  ------------------------------------------------------------ assessments
  insert into public.assessments (teacher_id, legacy_id, class_id, class_ids, title, subject, grade, framework,
    passage, status, source, answer_key_verified, target_standards, upload_refs, created_at)
  select p_teacher, a->>'id',
         (select cl.id from public.classes cl where cl.teacher_id = p_teacher and cl.legacy_id = a->>'classId'),
         coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(a->'classIds','[]'::jsonb)) x), '{}'),
         coalesce(nullif(a->>'title',''), 'Untitled assessment'),
         a->>'subject', a->>'grade', a->>'framework', a->>'passage',
         coalesce(nullif(a->>'status',''),'draft'), a->>'source',
         public.safe_bool(a->>'answerKeyVerified'),
         coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(a->'targetStandards','[]'::jsonb)) x), '{}'),
         jsonb_strip_nulls(jsonb_build_object(
           'uploadIds', a->'uploadIds', 'assignmentUploadIds', a->'assignmentUploadIds',
           'answerKeyUploadIds', a->'answerKeyUploadIds', 'studentUploadIds', a->'studentUploadIds')),
         coalesce((a->>'createdAt')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_data->'assessments','[]'::jsonb)) a
  where a->>'id' is not null
  on conflict (teacher_id, legacy_id) where legacy_id is not null do update set
    class_id = excluded.class_id, class_ids = excluded.class_ids, title = excluded.title,
    subject = excluded.subject, grade = excluded.grade, framework = excluded.framework,
    passage = excluded.passage, status = excluded.status, source = excluded.source,
    answer_key_verified = excluded.answer_key_verified, target_standards = excluded.target_standards,
    upload_refs = excluded.upload_refs, archived_at = null, updated_at = now();

  select coalesce(array_agg(a->>'id'), '{}') into ids
    from jsonb_array_elements(coalesce(p_data->'assessments','[]'::jsonb)) a;
  delete from public.assessments where teacher_id = p_teacher and legacy_id is not null and not (legacy_id = any(ids));
  get diagnostics d = row_count; n_del := n_del + d;

  -- evidence -> assessment links resolve now that assessments exist
  update public.student_evidence e set assessment_id = a.id
    from jsonb_array_elements(coalesce(p_data->'students','[]'::jsonb)) s,
         lateral jsonb_array_elements(coalesce(s->'evidence','[]'::jsonb)) ev
    join public.assessments a on a.teacher_id = p_teacher and a.legacy_id = ev->>'assessmentId'
   where e.teacher_id = p_teacher and e.legacy_id = ev->>'id' and e.assessment_id is distinct from a.id;

  ------------------------------------------------------------ questions
  insert into public.assessment_questions (assessment_id, teacher_id, legacy_id, number, text, passage, answer,
    standard_code, secondary_standard_code, skill, dok, costas, alignment, improvement, confidence, level, reasoning, verified, excluded)
  select an.id, p_teacher, q->>'id', public.safe_int(q->>'number'), q->>'text', q->>'passage', q->>'answer',
         nullif(q->>'standard',''), nullif(q->>'secondary',''), nullif(q->>'skill',''),
         public.safe_int(q->>'dok'), public.safe_int(q->>'costas'), public.safe_numeric(q->>'alignment'),
         nullif(q->>'improvement',''), public.safe_numeric(q->>'confidence'), nullif(q->>'level',''),
         nullif(q->>'reasoning',''), public.safe_bool(q->>'verified'), public.safe_bool(q->>'excluded')
  from jsonb_array_elements(coalesce(p_data->'assessments','[]'::jsonb)) a
  join public.assessments an on an.teacher_id = p_teacher and an.legacy_id = a->>'id'
  cross join lateral jsonb_array_elements(coalesce(a->'questions','[]'::jsonb)) q
  where q->>'id' is not null
  on conflict (assessment_id, legacy_id) where legacy_id is not null do update set
    number = excluded.number, text = excluded.text, passage = excluded.passage, answer = excluded.answer,
    standard_code = excluded.standard_code, secondary_standard_code = excluded.secondary_standard_code,
    skill = excluded.skill, dok = excluded.dok, costas = excluded.costas, alignment = excluded.alignment,
    improvement = excluded.improvement, confidence = excluded.confidence, level = excluded.level,
    reasoning = excluded.reasoning, verified = excluded.verified, excluded = excluded.excluded, updated_at = now();

  delete from public.assessment_questions q
   using public.assessments an
   where q.assessment_id = an.id and an.teacher_id = p_teacher and q.legacy_id is not null
     and not exists (
       select 1 from jsonb_array_elements(coalesce(p_data->'assessments','[]'::jsonb)) a,
                     lateral jsonb_array_elements(coalesce(a->'questions','[]'::jsonb)) qq
        where a->>'id' = an.legacy_id and qq->>'id' = q.legacy_id);
  get diagnostics d = row_count; n_del := n_del + d;

  ------------------------------------------------------------ responses
  insert into public.student_responses (teacher_id, assessment_id, question_id, student_id, legacy_id,
    answer, correct, match_score, misconception_text, misconception_key, confidence, verified)
  select p_teacher, an.id, qn.id, st.id, r->>'id', r->>'answer',
         case when r->>'correct' is null then null else public.safe_bool(r->>'correct') end,
         public.safe_numeric(r->>'match'), nullif(r->>'misconception',''), nullif(r->>'misconceptionKey',''),
         public.safe_numeric(r->>'confidence'), public.safe_bool(r->>'verified')
  from jsonb_array_elements(coalesce(p_data->'assessments','[]'::jsonb)) a
  join public.assessments an on an.teacher_id = p_teacher and an.legacy_id = a->>'id'
  cross join lateral jsonb_array_elements(coalesce(a->'responses','[]'::jsonb)) r
  join public.assessment_questions qn on qn.assessment_id = an.id and qn.legacy_id = r->>'questionId'
  join public.students st on st.teacher_id = p_teacher and st.legacy_id = r->>'studentId'
  where r->>'id' is not null
  on conflict (question_id, student_id) do update set
    legacy_id = excluded.legacy_id, answer = excluded.answer, correct = excluded.correct,
    match_score = excluded.match_score, misconception_text = excluded.misconception_text,
    misconception_key = coalesce(excluded.misconception_key, public.student_responses.misconception_key),
    confidence = excluded.confidence, verified = excluded.verified;

  select coalesce(array_agg(r->>'id'), '{}') into ids
    from jsonb_array_elements(coalesce(p_data->'assessments','[]'::jsonb)) a,
         lateral jsonb_array_elements(coalesce(a->'responses','[]'::jsonb)) r;
  delete from public.student_responses where teacher_id = p_teacher and legacy_id is not null and not (legacy_id = any(ids));
  get diagnostics d = row_count; n_del := n_del + d;

  ------------------------------------------------------------ lessons / resources (stored whole)
  insert into public.lessons (teacher_id, legacy_id, class_id, title, body, scheduled_for)
  select p_teacher, l->>'id',
         (select cl.id from public.classes cl where cl.teacher_id = p_teacher and cl.legacy_id = l->>'classId'),
         coalesce(nullif(l->>'title',''),'Untitled lesson'), l, public.safe_date(l->>'date')
  from jsonb_array_elements(coalesce(p_data->'lessons','[]'::jsonb)) l where l->>'id' is not null
  on conflict (teacher_id, legacy_id) where legacy_id is not null do update set
    class_id = excluded.class_id, title = excluded.title, body = excluded.body, scheduled_for = excluded.scheduled_for, updated_at = now();
  select coalesce(array_agg(l->>'id'), '{}') into ids from jsonb_array_elements(coalesce(p_data->'lessons','[]'::jsonb)) l;
  delete from public.lessons where teacher_id = p_teacher and legacy_id is not null and not (legacy_id = any(ids));
  get diagnostics d = row_count; n_del := n_del + d;

  insert into public.resources (teacher_id, legacy_id, title, kind, body)
  select p_teacher, r->>'id', coalesce(nullif(r->>'title',''),'Untitled resource'), nullif(r->>'category',''), r
  from jsonb_array_elements(coalesce(p_data->'resources','[]'::jsonb)) r where r->>'id' is not null
  on conflict (teacher_id, legacy_id) where legacy_id is not null do update set
    title = excluded.title, kind = excluded.kind, body = excluded.body, updated_at = now();
  select coalesce(array_agg(r->>'id'), '{}') into ids from jsonb_array_elements(coalesce(p_data->'resources','[]'::jsonb)) r;
  delete from public.resources where teacher_id = p_teacher and legacy_id is not null and not (legacy_id = any(ids));
  get diagnostics d = row_count; n_del := n_del + d;

  ------------------------------------------------------------ groups
  insert into public.student_groups (teacher_id, legacy_id, class_id, name, standard_code)
  select p_teacher, g->>'id',
         (select cl.id from public.classes cl where cl.teacher_id = p_teacher and cl.legacy_id = g->>'classId'),
         coalesce(nullif(g->>'name',''),'Group'), nullif(g->>'standard','')
  from jsonb_array_elements(coalesce(p_data->'groups','[]'::jsonb)) g where g->>'id' is not null
  on conflict (teacher_id, legacy_id) where legacy_id is not null do update set
    class_id = excluded.class_id, name = excluded.name, standard_code = excluded.standard_code, updated_at = now();
  select coalesce(array_agg(g->>'id'), '{}') into ids from jsonb_array_elements(coalesce(p_data->'groups','[]'::jsonb)) g;
  delete from public.student_groups where teacher_id = p_teacher and legacy_id is not null and not (legacy_id = any(ids));

  delete from public.student_group_members m using public.student_groups g
   where m.group_id = g.id and g.teacher_id = p_teacher;
  insert into public.student_group_members (group_id, student_id, teacher_id)
  select gr.id, st.id, p_teacher
  from jsonb_array_elements(coalesce(p_data->'groups','[]'::jsonb)) g
  join public.student_groups gr on gr.teacher_id = p_teacher and gr.legacy_id = g->>'id'
  cross join lateral jsonb_array_elements_text(coalesce(g->'studentIds','[]'::jsonb)) sid
  join public.students st on st.teacher_id = p_teacher and st.legacy_id = sid
  on conflict do nothing;

  ------------------------------------------------------------ custom standards
  insert into public.standards (teacher_id, jurisdiction, framework, subject, grade, code, short_label, description, domain, cluster)
  select p_teacher, 'CA', coalesce(nullif(cs->>'framework',''),'Custom'), cs->>'subject', cs->>'grade', cs->>'code',
         nullif(cs->>'title',''), coalesce(nullif(cs->>'wording',''), nullif(cs->>'summary',''), cs->>'code'),
         nullif(cs->>'domain',''), nullif(cs->>'cluster','')
  from jsonb_array_elements(coalesce(p_data->'customStandards','[]'::jsonb)) cs where cs->>'code' is not null
  on conflict (teacher_id, code) where teacher_id is not null do update set
    framework = excluded.framework, subject = excluded.subject, grade = excluded.grade,
    short_label = excluded.short_label, description = excluded.description,
    domain = excluded.domain, cluster = excluded.cluster, updated_at = now();
  select coalesce(array_agg(cs->>'code'), '{}') into ids from jsonb_array_elements(coalesce(p_data->'customStandards','[]'::jsonb)) cs;
  delete from public.standards where teacher_id = p_teacher and not (code = any(ids));

  ------------------------------------------------------------ resolve standard links
  update public.assessment_questions q set standard_id = s.id
    from public.standards s
   where q.teacher_id = p_teacher and q.standard_id is null and q.standard_code = s.code
     and (s.teacher_id is null or s.teacher_id = p_teacher);
  update public.student_evidence e set standard_id = s.id
    from public.standards s
   where e.teacher_id = p_teacher and e.standard_id is null and e.standard_code = s.code
     and (s.teacher_id is null or s.teacher_id = p_teacher);

  ------------------------------------------------------------ the row shrinks to settings + activeClassId
  insert into public.teacher_workspaces (owner_id, data, revision)
  values (p_teacher, jsonb_build_object('settings', coalesce(p_data->'settings','{}'::jsonb), 'activeClassId', p_data->'activeClassId'), 1)
  on conflict (owner_id) do update set
    data = jsonb_build_object('settings', coalesce(p_data->'settings','{}'::jsonb), 'activeClassId', p_data->'activeClassId'),
    revision = public.teacher_workspaces.revision + 1,
    updated_at = now();

  return jsonb_build_object(
    'classes',     (select count(*) from public.classes where teacher_id = p_teacher and archived_at is null),
    'students',    (select count(*) from public.students where teacher_id = p_teacher and archived_at is null),
    'assessments', (select count(*) from public.assessments where teacher_id = p_teacher and archived_at is null),
    'questions',   (select count(*) from public.assessment_questions where teacher_id = p_teacher),
    'responses',   (select count(*) from public.student_responses where teacher_id = p_teacher),
    'evidence',    (select count(*) from public.student_evidence where teacher_id = p_teacher),
    'deleted',     n_del);
end;
$$;

revoke execute on function public.sync_workspace(uuid, jsonb) from public, anon, authenticated;
