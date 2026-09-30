-- Persist ELA Writing: the genre and rubric on an assessment, and each
-- student's per-trait rubric scores.
--
-- Writing does not fit the student_responses path: its scores are keyed to
-- rubric-trait ids, not question ids, and that insert inner-joins
-- assessment_questions, so a writing response finds no question and is dropped.
-- So writing scores get their own table, student_writing_scores, and
-- get_workspace_json merges them back into the assessment's `responses` array
-- (keyed by the trait id, exactly as the app produced them). The genre and the
-- rubric itself are columns on assessments (rubric as jsonb).
--
-- Both functions are redefined whole (they already carry error_type,
-- points_possible and ela_area from earlier migrations); the genre/rubric and
-- writing-score lines are what's new. Earlier columns are re-added with
-- IF NOT EXISTS so this migration is self-contained.

alter table public.student_responses
  add column if not exists error_type text;
alter table public.assessments
  add column if not exists points_possible integer;
alter table public.assessments
  add column if not exists ela_area text;
alter table public.assessments
  add column if not exists genre text;
alter table public.assessments
  add column if not exists rubric jsonb;

-- One student's score on one rubric trait. Keyed by the trait id the app uses
-- as the response's questionId. Mirrors student_responses' ownership + RLS.
create table if not exists public.student_writing_scores (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  legacy_id text,
  dimension_id text not null,
  score integer,
  reason text,
  match_score numeric,
  correct boolean,
  confidence numeric,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  unique (assessment_id, student_id, dimension_id)
);
create index if not exists student_writing_scores_assessment_idx
  on public.student_writing_scores (assessment_id);
alter table public.student_writing_scores enable row level security;
do $rls$
begin
  if not exists (select 1 from pg_policy where polname = 'student_writing_scores_own_select') then
    create policy student_writing_scores_own_select on public.student_writing_scores
      for select using (teacher_id = (select auth.uid()));
    create policy student_writing_scores_own_insert on public.student_writing_scores
      for insert with check (teacher_id = (select auth.uid()));
    create policy student_writing_scores_own_update on public.student_writing_scores
      for update using (teacher_id = (select auth.uid())) with check (teacher_id = (select auth.uid()));
    create policy student_writing_scores_own_delete on public.student_writing_scores
      for delete using (teacher_id = (select auth.uid()));
  end if;
end $rls$;

------------------------------------------------------------------- write path
create or replace function public.sync_workspace(p_teacher uuid, p_data jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
    passage, status, source, answer_key_verified, target_standards, upload_refs, points_possible, ela_area, genre, rubric, created_at)
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
         public.safe_int(a->>'pointsPossible'), nullif(a->>'elaArea',''),
         nullif(a->>'genre',''),
         case when jsonb_typeof(a->'rubric') = 'array' then a->'rubric' else null end,
         coalesce((a->>'createdAt')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_data->'assessments','[]'::jsonb)) a
  where a->>'id' is not null
  on conflict (teacher_id, legacy_id) where legacy_id is not null do update set
    class_id = excluded.class_id, class_ids = excluded.class_ids, title = excluded.title,
    subject = excluded.subject, grade = excluded.grade, framework = excluded.framework,
    passage = excluded.passage, status = excluded.status, source = excluded.source,
    answer_key_verified = excluded.answer_key_verified, target_standards = excluded.target_standards,
    upload_refs = excluded.upload_refs, points_possible = excluded.points_possible, ela_area = excluded.ela_area,
    genre = excluded.genre, rubric = excluded.rubric,
    archived_at = null, updated_at = now();

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
    answer, correct, match_score, misconception_text, misconception_key, confidence, verified, error_type)
  select p_teacher, an.id, qn.id, st.id, r->>'id', r->>'answer',
         case when r->>'correct' is null then null else public.safe_bool(r->>'correct') end,
         public.safe_numeric(r->>'match'), nullif(r->>'misconception',''), nullif(r->>'misconceptionKey',''),
         public.safe_numeric(r->>'confidence'), public.safe_bool(r->>'verified'), nullif(r->>'errorType','')
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
    confidence = excluded.confidence, verified = excluded.verified, error_type = excluded.error_type;

  select coalesce(array_agg(r->>'id'), '{}') into ids
    from jsonb_array_elements(coalesce(p_data->'assessments','[]'::jsonb)) a,
         lateral jsonb_array_elements(coalesce(a->'responses','[]'::jsonb)) r;
  delete from public.student_responses where teacher_id = p_teacher and legacy_id is not null and not (legacy_id = any(ids));
  get diagnostics d = row_count; n_del := n_del + d;

  ------------------------------------------------------------ writing rubric scores
  -- A writing response is one whose questionId is a rubric trait of its own
  -- assessment (there is no matching question, so the responses insert above
  -- skipped it). Those land here instead, keyed by the trait id.
  insert into public.student_writing_scores (teacher_id, assessment_id, student_id, legacy_id,
    dimension_id, score, reason, match_score, correct, confidence, verified)
  select p_teacher, an.id, st.id, r->>'id', r->>'questionId',
         public.safe_int(r->>'rubricScore'), nullif(r->>'rubricReason',''), public.safe_numeric(r->>'match'),
         case when r->>'correct' is null then null else public.safe_bool(r->>'correct') end,
         public.safe_numeric(r->>'confidence'), public.safe_bool(r->>'verified')
  from jsonb_array_elements(coalesce(p_data->'assessments','[]'::jsonb)) a
  join public.assessments an on an.teacher_id = p_teacher and an.legacy_id = a->>'id'
  cross join lateral jsonb_array_elements(coalesce(a->'responses','[]'::jsonb)) r
  join public.students st on st.teacher_id = p_teacher and st.legacy_id = r->>'studentId'
  where r->>'id' is not null
    and exists (select 1 from jsonb_array_elements(coalesce(a->'rubric','[]'::jsonb)) dd
                 where dd->>'id' = r->>'questionId')
  on conflict (assessment_id, student_id, dimension_id) do update set
    legacy_id = excluded.legacy_id, score = excluded.score, reason = excluded.reason,
    match_score = excluded.match_score, correct = excluded.correct,
    confidence = excluded.confidence, verified = excluded.verified;

  select coalesce(array_agg(r->>'id'), '{}') into ids
    from jsonb_array_elements(coalesce(p_data->'assessments','[]'::jsonb)) a,
         lateral jsonb_array_elements(coalesce(a->'responses','[]'::jsonb)) r
   where exists (select 1 from jsonb_array_elements(coalesce(a->'rubric','[]'::jsonb)) dd
                  where dd->>'id' = r->>'questionId');
  delete from public.student_writing_scores where teacher_id = p_teacher and not (legacy_id = any(ids));
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
$function$;

------------------------------------------------------------------- read path
create or replace function public.get_workspace_json(p_teacher uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
with
cls as (select c.*, c.legacy_id as cid from public.classes c
         where c.teacher_id = p_teacher and c.archived_at is null),
stu as (select s.*, coalesce(cl.legacy_id, s.legacy_class_id) as class_legacy
          from public.students s left join public.classes cl on cl.id = s.class_id
         where s.teacher_id = p_teacher and s.archived_at is null),
asm as (select a.*, cl.legacy_id as class_legacy
          from public.assessments a left join public.classes cl on cl.id = a.class_id
         where a.teacher_id = p_teacher and a.archived_at is null),
std as (
  select s.teacher_id, s.framework, s.grade, s.code, s.created_at,
         jsonb_build_object(
           'code', s.code,
           'title', coalesce(s.short_label, s.code),
           'subject', s.subject,
           'grade', coalesce(public.safe_int(s.grade), 0),
           'domain', coalesce(s.domain, ''),
           'cluster', coalesce(s.cluster, ''),
           'wording', coalesce(s.description, ''),
           'summary', coalesce(s.description, ''),
           'framework', s.framework,
           'skills', case when jsonb_typeof(m.meta -> 'skills') = 'array'
                          then m.meta -> 'skills' else '[]'::jsonb end,
           'prerequisites', '[]'::jsonb,
           'next', '[]'::jsonb,
           'vocabulary', '[]'::jsonb,
           'misconception', coalesce(m.meta ->> 'misconception',
             'Use the student''s written reasoning to identify the step that needs support.'),
           'example', coalesce(m.meta ->> 'example',
             'Choose a task that directly demonstrates this standard.'),
           'dok', coalesce(public.safe_int(m.meta ->> 'dok'), 2),
           'source', coalesce(m.meta ->> 'source', '')
         ) as js
    from public.standards s
    left join lateral (
      select coalesce(
        s.meta,
        (select g.meta from public.standards g
          where g.teacher_id is null and g.active
            and g.code = s.code and g.framework = s.framework and g.grade = s.grade
          limit 1)
      ) as meta
    ) m on true
   where s.teacher_id = p_teacher or (s.teacher_id is null and s.active)
),
ws as (select data from public.teacher_workspaces where owner_id = p_teacher)
select jsonb_build_object(
  'classes', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
       'id', cid, 'name', name,
       'grade', coalesce(public.safe_int(grade), 0),
       'framework', framework,
       'demo', is_demo)) order by created_at) from cls), '[]'::jsonb),

  'students', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
       'id', s.legacy_id, 'classId', s.class_legacy, 'name', s.display_label,
       'fullName', s.full_name,
       'color', coalesce(s.color, ''),
       'notes', coalesce(s.notes, ''),
       'evidence', coalesce((select jsonb_agg(jsonb_build_object(
            'id', e.legacy_id,
            'standard', coalesce(e.standard_code, ''),
            'score', coalesce(e.score, 0),
            'date', e.recorded_on,
            'source', coalesce(e.source, ''),
            'assessmentId', ea.legacy_id) order by e.recorded_on, e.created_at)
          from public.student_evidence e
          left join public.assessments ea on ea.id = e.assessment_id
          where e.student_id = s.id), '[]'::jsonb)
     )) order by s.created_at) from stu s), '[]'::jsonb),

  'assessments', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
       'id', a.legacy_id, 'classId', a.class_legacy, 'classIds', to_jsonb(a.class_ids),
       'title', a.title, 'subject', a.subject,
       'grade', coalesce(public.safe_int(a.grade), 0),
       'framework', a.framework,
       'createdAt', a.created_at, 'status', a.status, 'source', a.source,
       'targetStandards', to_jsonb(a.target_standards), 'passage', a.passage,
       'answerKeyVerified', a.answer_key_verified, 'pointsPossible', a.points_possible,
       'elaArea', a.ela_area, 'genre', a.genre, 'rubric', a.rubric,
       'uploadIds', coalesce(a.upload_refs -> 'uploadIds', '[]'::jsonb),
       'assignmentUploadIds', coalesce(a.upload_refs -> 'assignmentUploadIds', '[]'::jsonb),
       'answerKeyUploadIds', coalesce(a.upload_refs -> 'answerKeyUploadIds', '[]'::jsonb),
       'studentUploadIds', coalesce(a.upload_refs -> 'studentUploadIds', '{}'::jsonb),
       'questions', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'id', q.legacy_id, 'number', q.number, 'text', q.text, 'passage', q.passage, 'answer', q.answer,
            'standard', coalesce(q.standard_code, ''), 'secondary', coalesce(q.secondary_standard_code, ''),
            'skill', q.skill, 'dok', q.dok, 'costas', q.costas, 'alignment', q.alignment,
            'improvement', q.improvement, 'confidence', q.confidence, 'level', q.level,
            'reasoning', q.reasoning, 'verified', q.verified, 'excluded', q.excluded))
            order by q.number, q.created_at)
          from public.assessment_questions q where q.assessment_id = a.id), '[]'::jsonb),
       -- Key-based responses (student_responses) and writing rubric scores
       -- (student_writing_scores) both surface here as the app's responses,
       -- each keyed by its questionId (a real question id, or a rubric trait id).
       'responses', coalesce((select jsonb_agg(js order by ord) from (
            select r.created_at as ord, jsonb_strip_nulls(jsonb_build_object(
              'id', r.legacy_id, 'studentId', st.legacy_id, 'questionId', q.legacy_id,
              'answer', r.answer, 'correct', r.correct, 'match', r.match_score,
              'misconception', r.misconception_text, 'misconceptionKey', r.misconception_key,
              'confidence', r.confidence, 'verified', r.verified, 'errorType', r.error_type)) as js
            from public.student_responses r
            join public.students st on st.id = r.student_id
            join public.assessment_questions q on q.id = r.question_id
            where r.assessment_id = a.id
            union all
            select ws.created_at as ord, jsonb_strip_nulls(jsonb_build_object(
              'id', ws.legacy_id, 'studentId', st.legacy_id, 'questionId', ws.dimension_id,
              'answer', '', 'correct', ws.correct, 'match', ws.match_score,
              'rubricScore', ws.score, 'rubricReason', ws.reason,
              'confidence', ws.confidence, 'verified', ws.verified)) as js
            from public.student_writing_scores ws
            join public.students st on st.id = ws.student_id
            where ws.assessment_id = a.id
          ) merged), '[]'::jsonb)
     )) order by a.created_at) from asm a), '[]'::jsonb),

  'lessons', coalesce((select jsonb_agg(l.body order by l.created_at)
     from public.lessons l where l.teacher_id = p_teacher and l.body is not null), '[]'::jsonb),
  'resources', coalesce((select jsonb_agg(r.body order by r.created_at)
     from public.resources r where r.teacher_id = p_teacher and r.body is not null), '[]'::jsonb),

  'groups', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
       'id', g.legacy_id, 'classId', gc.legacy_id, 'name', g.name, 'standard', g.standard_code,
       'studentIds', coalesce((select jsonb_agg(st.legacy_id)
          from public.student_group_members m
          join public.students st on st.id = m.student_id
          where m.group_id = g.id), '[]'::jsonb))) order by g.created_at)
     from public.student_groups g
     left join public.classes gc on gc.id = g.class_id
     where g.teacher_id = p_teacher), '[]'::jsonb),

  'customStandards', coalesce((select jsonb_agg(js order by created_at)
     from std where teacher_id = p_teacher), '[]'::jsonb),
  'sharedStandards', coalesce((select jsonb_agg(js order by framework, grade, code)
     from std where teacher_id is null), '[]'::jsonb),

  'settings', coalesce((select data -> 'settings' from ws), '{}'::jsonb),
  'activeClassId', (select data -> 'activeClassId' from ws));
$function$;
