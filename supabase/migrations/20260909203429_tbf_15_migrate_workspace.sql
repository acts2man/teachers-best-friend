-- ===============================================================
-- migrate_workspace(teacher)
-- Reads teacher_workspaces.data and populates the relational tables.
-- Idempotent: safe to run repeatedly. Never deletes the source blob.
--
-- PRIVACY NOTE: the blob's students[].name goes to display_label only.
-- full_name is left NULL on purpose — the product is designed to work
-- without it, and that is the whole point of the column split.
-- ===============================================================
create or replace function public.migrate_workspace(p_teacher uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  w jsonb;
  n_classes int; n_students int; n_assess int;
  n_q int; n_resp int; n_ev int; n_lessons int; n_res int; n_groups int; n_custom int;
  n_resolved int;
begin
  select data into w from public.teacher_workspaces where owner_id = p_teacher;
  if w is null then
    return jsonb_build_object('error', 'no workspace row for teacher', 'teacher', p_teacher);
  end if;

  ---------------------------------------------------------------- classes
  insert into public.classes (teacher_id, legacy_id, name, grade, framework, color, is_demo)
  select p_teacher, c->>'id', coalesce(nullif(c->>'name',''), 'Untitled class'),
         c->>'grade', c->>'framework', c->>'color', public.safe_bool(c->>'demo')
  from jsonb_array_elements(coalesce(w->'classes','[]'::jsonb)) c
  on conflict (teacher_id, legacy_id) where legacy_id is not null do nothing;
  get diagnostics n_classes = row_count;

  ---------------------------------------------------------------- students
  insert into public.students (teacher_id, legacy_id, class_id, display_label, color, notes)
  select p_teacher, s->>'id',
         (select cl.id from public.classes cl
           where cl.teacher_id = p_teacher and cl.legacy_id = s->>'classId'),
         coalesce(nullif(s->>'name',''), 'Student'),
         s->>'color',
         nullif(s->>'notes','')
  from jsonb_array_elements(coalesce(w->'students','[]'::jsonb)) s
  on conflict (teacher_id, legacy_id) where legacy_id is not null do nothing;
  get diagnostics n_students = row_count;

  ---------------------------------------------------------------- assessments
  insert into public.assessments (teacher_id, legacy_id, class_id, title, subject, grade,
                                  framework, passage, status, source, answer_key_verified, created_at)
  select p_teacher, a->>'id',
         (select cl.id from public.classes cl
           where cl.teacher_id = p_teacher and cl.legacy_id = a->>'classId'),
         coalesce(nullif(a->>'title',''), 'Untitled assessment'),
         a->>'subject', a->>'grade', a->>'framework', a->>'passage',
         coalesce(nullif(a->>'status',''), 'draft'), a->>'source',
         public.safe_bool(a->>'answerKeyVerified'),
         coalesce((a->>'createdAt')::timestamptz, now())
  from jsonb_array_elements(coalesce(w->'assessments','[]'::jsonb)) a
  on conflict (teacher_id, legacy_id) where legacy_id is not null do nothing;
  get diagnostics n_assess = row_count;

  ---------------------------------------------------------------- questions
  insert into public.assessment_questions (
    assessment_id, teacher_id, legacy_id, number, text, passage, answer,
    standard_code, secondary_standard_code, skill, dok, costas, alignment,
    improvement, confidence, level, reasoning, verified, excluded)
  select an.id, p_teacher, q->>'id', public.safe_int(q->>'number'),
         q->>'text', q->>'passage', q->>'answer',
         nullif(q->>'standard',''), nullif(q->>'secondary',''), nullif(q->>'skill',''),
         public.safe_int(q->>'dok'), public.safe_int(q->>'costas'),
         public.safe_numeric(q->>'alignment'), nullif(q->>'improvement',''),
         public.safe_numeric(q->>'confidence'), nullif(q->>'level',''),
         nullif(q->>'reasoning',''),
         public.safe_bool(q->>'verified'), public.safe_bool(q->>'excluded')
  from jsonb_array_elements(coalesce(w->'assessments','[]'::jsonb)) a
  join public.assessments an
    on an.teacher_id = p_teacher and an.legacy_id = a->>'id'
  cross join lateral jsonb_array_elements(coalesce(a->'questions','[]'::jsonb)) q
  on conflict (assessment_id, legacy_id) where legacy_id is not null do nothing;
  get diagnostics n_q = row_count;

  ---------------------------------------------------------------- responses
  insert into public.student_responses (
    teacher_id, assessment_id, question_id, student_id, legacy_id,
    answer, correct, match_score, misconception_text, confidence, verified)
  select p_teacher, an.id, qn.id, st.id, r->>'id',
         r->>'answer',
         case when r->>'correct' is null then null else public.safe_bool(r->>'correct') end,
         public.safe_numeric(r->>'match'),
         nullif(r->>'misconception',''),
         public.safe_numeric(r->>'confidence'),
         public.safe_bool(r->>'verified')
  from jsonb_array_elements(coalesce(w->'assessments','[]'::jsonb)) a
  join public.assessments an
    on an.teacher_id = p_teacher and an.legacy_id = a->>'id'
  cross join lateral jsonb_array_elements(coalesce(a->'responses','[]'::jsonb)) r
  join public.assessment_questions qn
    on qn.assessment_id = an.id and qn.legacy_id = r->>'questionId'
  join public.students st
    on st.teacher_id = p_teacher and st.legacy_id = r->>'studentId'
  on conflict (question_id, student_id) do nothing;
  get diagnostics n_resp = row_count;

  ---------------------------------------------------------------- evidence
  insert into public.student_evidence (
    teacher_id, student_id, standard_code, assessment_id, score, source, recorded_on, legacy_id)
  select p_teacher, st.id, nullif(e->>'standard',''),
         (select an.id from public.assessments an
           where an.teacher_id = p_teacher and an.legacy_id = e->>'assessmentId'),
         public.safe_numeric(e->>'score'), nullif(e->>'source',''),
         coalesce(public.safe_date(e->>'date'), current_date),
         e->>'id'
  from jsonb_array_elements(coalesce(w->'students','[]'::jsonb)) s
  join public.students st on st.teacher_id = p_teacher and st.legacy_id = s->>'id'
  cross join lateral jsonb_array_elements(coalesce(s->'evidence','[]'::jsonb)) e
  where not exists (
    select 1 from public.student_evidence ex
     where ex.teacher_id = p_teacher and ex.legacy_id = e->>'id');
  get diagnostics n_ev = row_count;

  ---------------------------------------------------------------- lessons
  insert into public.lessons (teacher_id, legacy_id, class_id, title, body, scheduled_for)
  select p_teacher, l->>'id',
         (select cl.id from public.classes cl where cl.teacher_id = p_teacher and cl.legacy_id = l->>'classId'),
         coalesce(nullif(l->>'title',''), 'Untitled lesson'), l, public.safe_date(l->>'date')
  from jsonb_array_elements(coalesce(w->'lessons','[]'::jsonb)) l
  on conflict (teacher_id, legacy_id) where legacy_id is not null do nothing;
  get diagnostics n_lessons = row_count;

  ---------------------------------------------------------------- resources
  insert into public.resources (teacher_id, legacy_id, title, kind, body)
  select p_teacher, r->>'id', coalesce(nullif(r->>'title',''), 'Untitled resource'),
         nullif(r->>'category',''), r
  from jsonb_array_elements(coalesce(w->'resources','[]'::jsonb)) r
  on conflict (teacher_id, legacy_id) where legacy_id is not null do nothing;
  get diagnostics n_res = row_count;

  ---------------------------------------------------------------- groups
  insert into public.student_groups (teacher_id, legacy_id, class_id, name, purpose)
  select p_teacher, g->>'id',
         (select cl.id from public.classes cl where cl.teacher_id = p_teacher and cl.legacy_id = g->>'classId'),
         coalesce(nullif(g->>'name',''), 'Group'), nullif(g->>'standard','')
  from jsonb_array_elements(coalesce(w->'groups','[]'::jsonb)) g
  on conflict (teacher_id, legacy_id) where legacy_id is not null do nothing;
  get diagnostics n_groups = row_count;

  insert into public.student_group_members (group_id, student_id, teacher_id)
  select gr.id, st.id, p_teacher
  from jsonb_array_elements(coalesce(w->'groups','[]'::jsonb)) g
  join public.student_groups gr on gr.teacher_id = p_teacher and gr.legacy_id = g->>'id'
  cross join lateral jsonb_array_elements_text(coalesce(g->'studentIds','[]'::jsonb)) sid
  join public.students st on st.teacher_id = p_teacher and st.legacy_id = sid
  on conflict do nothing;

  ---------------------------------------------------------------- custom standards
  insert into public.standards (teacher_id, jurisdiction, framework, subject, grade, code,
                                short_label, description, domain, cluster)
  select p_teacher, 'CA', coalesce(nullif(cs->>'framework',''), 'Custom'),
         cs->>'subject', cs->>'grade', cs->>'code',
         nullif(cs->>'title',''),
         coalesce(nullif(cs->>'wording',''), nullif(cs->>'summary',''), cs->>'code'),
         nullif(cs->>'domain',''), nullif(cs->>'cluster','')
  from jsonb_array_elements(coalesce(w->'customStandards','[]'::jsonb)) cs
  where not exists (
    select 1 from public.standards s2
     where s2.teacher_id = p_teacher and s2.code = cs->>'code');
  get diagnostics n_custom = row_count;

  ---------------------------------------------------------------- link codes to standards
  update public.assessment_questions q
     set standard_id = s.id
    from public.standards s
   where q.teacher_id = p_teacher
     and q.standard_id is null
     and q.standard_code is not null
     and s.code = q.standard_code
     and (s.teacher_id is null or s.teacher_id = p_teacher);
  get diagnostics n_resolved = row_count;

  update public.student_evidence ev
     set standard_id = s.id
    from public.standards s
   where ev.teacher_id = p_teacher
     and ev.standard_id is null
     and ev.standard_code is not null
     and s.code = ev.standard_code
     and (s.teacher_id is null or s.teacher_id = p_teacher);

  return jsonb_build_object(
    'teacher', p_teacher,
    'classes', n_classes, 'students', n_students, 'assessments', n_assess,
    'questions', n_q, 'responses', n_resp, 'evidence', n_ev,
    'lessons', n_lessons, 'resources', n_res, 'groups', n_groups,
    'custom_standards', n_custom,
    'standard_codes_resolved', n_resolved
  );
end;
$$;

revoke execute on function public.migrate_workspace(uuid) from public, anon, authenticated;
