-- Production schema snapshot for the workspace save (tests/workspace-sql.test.mjs).
-- Read-only from the production catalog on 2026-11-05: the 13 tables sync_workspace and
-- get_workspace_json touch (columns, keys, unique indexes, foreign keys among them), the
-- safe_* helpers, and both functions as they are live, before migration
-- 20261104120000 (check_pages). Schema only: no rows, no data. standards.embedding is
-- jsonb here (no pgvector in the test database) and its vector index is left out.
-- Regenerate when either function changes on production.

create table public.assessment_questions (id uuid default gen_random_uuid() not null, assessment_id uuid not null, teacher_id uuid not null, legacy_id text, number integer, text text, passage text, answer text, standard_id uuid, standard_code text, secondary_standard_code text, skill text, dok integer, costas integer, alignment numeric(5,2), improvement text, confidence numeric(5,2), level text, reasoning text, verified boolean default false not null, excluded boolean default false not null, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null, key_check jsonb, points numeric, answer_parts integer, second_choice boolean);
create table public.assessments (id uuid default gen_random_uuid() not null, teacher_id uuid not null, class_id uuid, title text not null, subject text, grade text, assigned_on date, answer_key jsonb, item_count integer, archived_at timestamp with time zone, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null, passage text, status text default 'draft'::text, source text, answer_key_verified boolean default false not null, framework text, legacy_id text, class_ids text[] default '{}'::text[] not null, target_standards text[] default '{}'::text[] not null, upload_refs jsonb default '{}'::jsonb not null, points_possible numeric, ela_area text, genre text, rubric jsonb, student_order jsonb, grading_mode text, date_given date);
create table public.classes (id uuid default gen_random_uuid() not null, teacher_id uuid not null, name text not null, subject text, grade text, period text, school_year text, color text, archived_at timestamp with time zone, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null, legacy_id text, framework text, is_demo boolean default false not null, grading_mode text);
create table public.lessons (id uuid default gen_random_uuid() not null, teacher_id uuid not null, class_id uuid, title text not null, body jsonb, scheduled_for date, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null, legacy_id text);
create table public.resources (id uuid default gen_random_uuid() not null, teacher_id uuid not null, title text not null, kind text, url text, body jsonb, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null, legacy_id text);
create table public.standards (id uuid default gen_random_uuid() not null, teacher_id uuid, jurisdiction text default 'CA'::text not null, framework text not null, subject text not null, grade text not null, code text not null, short_label text, description text not null, domain text, cluster text, parent_code text, embedding jsonb, active boolean default true not null, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null, meta jsonb);
create table public.student_evidence (id uuid default gen_random_uuid() not null, teacher_id uuid not null, student_id uuid not null, standard_id uuid, standard_code text, assessment_id uuid, score numeric(5,2), source text, recorded_on date default CURRENT_DATE not null, legacy_id text, created_at timestamp with time zone default now() not null);
create table public.student_group_members (group_id uuid not null, student_id uuid not null, teacher_id uuid not null, added_at timestamp with time zone default now() not null);
create table public.student_groups (id uuid default gen_random_uuid() not null, teacher_id uuid not null, class_id uuid, name text not null, purpose text, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null, legacy_id text, standard_code text);
create table public.student_responses (id uuid default gen_random_uuid() not null, teacher_id uuid not null, assessment_id uuid not null, question_id uuid not null, student_id uuid not null, scan_id uuid, legacy_id text, answer text, correct boolean, match_score numeric(5,2), misconception_key text, misconception_text text, reteaching_id uuid, served_from_cache boolean default false not null, confidence numeric(5,2), verified boolean default false not null, created_at timestamp with time zone default now() not null, error_type text, final_answer text, answer_region jsonb, suggested_error_type text, graded_alone boolean, legacy_error_type text, legacy_suggested_error_type text);
create table public.student_writing_scores (id uuid default gen_random_uuid() not null, teacher_id uuid not null, assessment_id uuid not null, student_id uuid not null, legacy_id text, dimension_id text not null, score integer, reason text, match_score numeric, correct boolean, confidence numeric, verified boolean default false not null, created_at timestamp with time zone default now() not null);
create table public.students (id uuid default gen_random_uuid() not null, teacher_id uuid not null, class_id uuid, display_label text not null, full_name text, external_ref text, color text, notes text, notes_expire_at timestamp with time zone, archived_at timestamp with time zone, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null, legacy_id text, legacy_class_id text);
create table public.teacher_workspaces (owner_id uuid not null, data jsonb not null, revision integer default 0 not null, updated_at timestamp with time zone default now() not null);

alter table public.student_writing_scores add constraint student_writing_scores_assessment_id_student_id_dimension_i_key UNIQUE (assessment_id, student_id, dimension_id);
alter table public.classes add constraint classes_pkey PRIMARY KEY (id);
alter table public.assessments add constraint assessments_pkey PRIMARY KEY (id);
alter table public.student_responses add constraint student_responses_pkey PRIMARY KEY (id);
alter table public.student_evidence add constraint student_evidence_pkey PRIMARY KEY (id);
alter table public.student_group_members add constraint student_group_members_pkey PRIMARY KEY (group_id, student_id);
alter table public.standards add constraint standards_pkey PRIMARY KEY (id);
alter table public.student_groups add constraint student_groups_pkey PRIMARY KEY (id);
alter table public.student_writing_scores add constraint student_writing_scores_pkey PRIMARY KEY (id);
alter table public.assessment_questions add constraint assessment_questions_pkey PRIMARY KEY (id);
alter table public.resources add constraint resources_pkey PRIMARY KEY (id);
alter table public.students add constraint students_pkey PRIMARY KEY (id);
alter table public.teacher_workspaces add constraint teacher_workspaces_pkey PRIMARY KEY (owner_id);
alter table public.lessons add constraint lessons_pkey PRIMARY KEY (id);
alter table public.student_evidence add constraint student_evidence_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;
alter table public.student_groups add constraint student_groups_class_id_fkey FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE;
alter table public.students add constraint students_class_id_fkey FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL;
alter table public.assessment_questions add constraint assessment_questions_assessment_id_fkey FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE;
alter table public.assessment_questions add constraint assessment_questions_standard_id_fkey FOREIGN KEY (standard_id) REFERENCES standards(id) ON DELETE SET NULL;
alter table public.lessons add constraint lessons_class_id_fkey FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL;
alter table public.assessments add constraint assessments_class_id_fkey FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL;
alter table public.student_group_members add constraint student_group_members_group_id_fkey FOREIGN KEY (group_id) REFERENCES student_groups(id) ON DELETE CASCADE;
alter table public.student_group_members add constraint student_group_members_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;
alter table public.student_writing_scores add constraint student_writing_scores_assessment_id_fkey FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE;
alter table public.student_writing_scores add constraint student_writing_scores_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;
alter table public.student_responses add constraint student_responses_assessment_id_fkey FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE;
alter table public.student_responses add constraint student_responses_question_id_fkey FOREIGN KEY (question_id) REFERENCES assessment_questions(id) ON DELETE CASCADE;
alter table public.student_responses add constraint student_responses_student_id_fkey FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;
alter table public.student_evidence add constraint student_evidence_assessment_id_fkey FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE SET NULL;
alter table public.student_evidence add constraint student_evidence_standard_id_fkey FOREIGN KEY (standard_id) REFERENCES standards(id) ON DELETE SET NULL;
alter table public.classes add constraint classes_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 120)));
alter table public.assessments add constraint assessments_grading_mode_check CHECK (((grading_mode IS NULL) OR (grading_mode = 'sbg'::text)));
alter table public.assessment_questions add constraint assessment_questions_answer_parts_check CHECK (((answer_parts IS NULL) OR ((answer_parts >= 1) AND (answer_parts <= 20))));
alter table public.assessments add constraint assessments_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 200)));
alter table public.students add constraint students_display_label_check CHECK (((char_length(display_label) >= 1) AND (char_length(display_label) <= 60)));
alter table public.teacher_workspaces add constraint teacher_workspaces_revision_check CHECK ((revision >= 0));
alter table public.classes add constraint classes_grading_mode_check CHECK (((grading_mode IS NULL) OR (grading_mode = ANY (ARRAY['percentage'::text, 'sbg'::text]))));

CREATE UNIQUE INDEX resources_legacy_key ON public.resources USING btree (teacher_id, legacy_id) WHERE (legacy_id IS NOT NULL);
CREATE UNIQUE INDEX groups_legacy_key ON public.student_groups USING btree (teacher_id, legacy_id) WHERE (legacy_id IS NOT NULL);
CREATE INDEX student_groups_class_idx ON public.student_groups USING btree (class_id);
CREATE INDEX students_teacher_idx ON public.students USING btree (teacher_id) WHERE (archived_at IS NULL);
CREATE INDEX students_class_idx ON public.students USING btree (class_id) WHERE (archived_at IS NULL);
CREATE UNIQUE INDEX students_legacy_key ON public.students USING btree (teacher_id, legacy_id) WHERE (legacy_id IS NOT NULL);
CREATE INDEX questions_assessment_idx ON public.assessment_questions USING btree (assessment_id);
CREATE INDEX questions_teacher_idx ON public.assessment_questions USING btree (teacher_id);
CREATE INDEX questions_standard_idx ON public.assessment_questions USING btree (standard_id);
CREATE UNIQUE INDEX questions_legacy_key ON public.assessment_questions USING btree (assessment_id, legacy_id) WHERE (legacy_id IS NOT NULL);
CREATE UNIQUE INDEX lessons_legacy_key ON public.lessons USING btree (teacher_id, legacy_id) WHERE (legacy_id IS NOT NULL);
CREATE INDEX lessons_class_idx ON public.lessons USING btree (class_id);
CREATE INDEX assessments_teacher_idx ON public.assessments USING btree (teacher_id) WHERE (archived_at IS NULL);
CREATE UNIQUE INDEX assessments_legacy_key ON public.assessments USING btree (teacher_id, legacy_id) WHERE (legacy_id IS NOT NULL);
CREATE INDEX assessments_class_idx ON public.assessments USING btree (class_id);
CREATE INDEX group_members_student_idx ON public.student_group_members USING btree (student_id);
CREATE INDEX student_group_members_teacher_idx ON public.student_group_members USING btree (teacher_id);
CREATE INDEX student_writing_scores_assessment_idx ON public.student_writing_scores USING btree (assessment_id);
CREATE INDEX responses_assessment_idx ON public.student_responses USING btree (assessment_id);
CREATE INDEX responses_student_idx ON public.student_responses USING btree (student_id);
CREATE INDEX responses_question_idx ON public.student_responses USING btree (question_id);
CREATE INDEX responses_teacher_idx ON public.student_responses USING btree (teacher_id);
CREATE INDEX responses_wrong_idx ON public.student_responses USING btree (misconception_key) WHERE (correct = false);
CREATE UNIQUE INDEX responses_unique_key ON public.student_responses USING btree (question_id, student_id);
CREATE UNIQUE INDEX responses_legacy_key ON public.student_responses USING btree (teacher_id, legacy_id) WHERE (legacy_id IS NOT NULL);
CREATE INDEX student_responses_reteaching_idx ON public.student_responses USING btree (reteaching_id);
CREATE INDEX student_responses_scan_idx ON public.student_responses USING btree (scan_id);
CREATE INDEX classes_teacher_idx ON public.classes USING btree (teacher_id) WHERE (archived_at IS NULL);
CREATE UNIQUE INDEX classes_legacy_key ON public.classes USING btree (teacher_id, legacy_id) WHERE (legacy_id IS NOT NULL);
CREATE UNIQUE INDEX standards_global_code_key ON public.standards USING btree (jurisdiction, framework, code) WHERE (teacher_id IS NULL);
CREATE INDEX standards_teacher_idx ON public.standards USING btree (teacher_id) WHERE (teacher_id IS NOT NULL);
CREATE INDEX standards_lookup_idx ON public.standards USING btree (jurisdiction, subject, grade) WHERE active;
CREATE UNIQUE INDEX custom_standards_identity_key ON public.standards USING btree (teacher_id, framework, grade, subject, code) WHERE (teacher_id IS NOT NULL);
CREATE INDEX evidence_standard_idx ON public.student_evidence USING btree (standard_code);
CREATE INDEX evidence_student_idx ON public.student_evidence USING btree (student_id, recorded_on DESC);
CREATE INDEX evidence_teacher_idx ON public.student_evidence USING btree (teacher_id);
CREATE UNIQUE INDEX evidence_legacy_key ON public.student_evidence USING btree (teacher_id, legacy_id) WHERE (legacy_id IS NOT NULL);
CREATE INDEX student_evidence_assessment_idx ON public.student_evidence USING btree (assessment_id);
CREATE INDEX student_evidence_standard_fk_idx ON public.student_evidence USING btree (standard_id);

CREATE OR REPLACE FUNCTION public.safe_bool(t text, d boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
begin return coalesce(t::boolean, d); exception when others then return d; end; $function$;

CREATE OR REPLACE FUNCTION public.safe_date(t text)
 RETURNS date
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
begin return t::date; exception when others then return null; end; $function$;

CREATE OR REPLACE FUNCTION public.safe_int(t text)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
begin return t::integer; exception when others then return null; end; $function$;

CREATE OR REPLACE FUNCTION public.safe_numeric(t text)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
begin return t::numeric; exception when others then return null; end; $function$;

CREATE OR REPLACE FUNCTION public.sync_workspace(p_teacher uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  ids text[];
  n_del int := 0; d int;
begin
  insert into public.classes (teacher_id, legacy_id, name, grade, framework, color, is_demo, grading_mode)
  select p_teacher, c->>'id', coalesce(nullif(c->>'name',''),'Untitled class'),
         c->>'grade', c->>'framework', c->>'color', public.safe_bool(c->>'demo'), case when c->>'gradingMode' in ('percentage', 'sbg') then c->>'gradingMode' end
  from jsonb_array_elements(coalesce(p_data->'classes','[]'::jsonb)) c
  where c->>'id' is not null
  on conflict (teacher_id, legacy_id) where legacy_id is not null do update set
    name = excluded.name, grade = excluded.grade, framework = excluded.framework,
    color = excluded.color, is_demo = excluded.is_demo, grading_mode = excluded.grading_mode, archived_at = null, updated_at = now();
  select coalesce(array_agg(c->>'id'), '{}') into ids
    from jsonb_array_elements(coalesce(p_data->'classes','[]'::jsonb)) c;
  delete from public.classes where teacher_id = p_teacher and legacy_id is not null and not (legacy_id = any(ids));
  get diagnostics d = row_count; n_del := n_del + d;
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
  insert into public.assessments (teacher_id, legacy_id, class_id, class_ids, title, subject, grade, framework,
    passage, status, source, answer_key_verified, target_standards, upload_refs, points_possible, ela_area, genre, rubric, student_order, grading_mode, date_given, created_at)
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
         case when public.safe_numeric(a->>'pointsPossible') > 0 and public.safe_numeric(a->>'pointsPossible') <= 1000000 then trim_scale(round(public.safe_numeric(a->>'pointsPossible'), 2)) end, nullif(a->>'elaArea',''),
         nullif(a->>'genre',''),
         case when jsonb_typeof(a->'rubric') = 'array' then a->'rubric' else null end,
         case when jsonb_typeof(a->'studentOrder') = 'array' then a->'studentOrder' else null end, case when a->>'gradingMode' = 'sbg' then 'sbg' end, case when a->>'dateGiven' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then public.safe_date(a->>'dateGiven') end,
         coalesce((a->>'createdAt')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_data->'assessments','[]'::jsonb)) a
  where a->>'id' is not null
  on conflict (teacher_id, legacy_id) where legacy_id is not null do update set
    class_id = excluded.class_id, class_ids = excluded.class_ids, title = excluded.title,
    subject = excluded.subject, grade = excluded.grade, framework = excluded.framework,
    passage = excluded.passage, status = excluded.status, source = excluded.source,
    answer_key_verified = excluded.answer_key_verified, target_standards = excluded.target_standards,
    upload_refs = excluded.upload_refs, points_possible = excluded.points_possible, ela_area = excluded.ela_area,
    genre = excluded.genre, rubric = excluded.rubric, student_order = excluded.student_order, grading_mode = excluded.grading_mode, date_given = excluded.date_given,
    archived_at = null, updated_at = now();
  select coalesce(array_agg(a->>'id'), '{}') into ids
    from jsonb_array_elements(coalesce(p_data->'assessments','[]'::jsonb)) a;
  delete from public.assessments where teacher_id = p_teacher and legacy_id is not null and not (legacy_id = any(ids));
  get diagnostics d = row_count; n_del := n_del + d;
  update public.student_evidence e set assessment_id = a.id
    from jsonb_array_elements(coalesce(p_data->'students','[]'::jsonb)) s,
         lateral jsonb_array_elements(coalesce(s->'evidence','[]'::jsonb)) ev
    join public.assessments a on a.teacher_id = p_teacher and a.legacy_id = ev->>'assessmentId'
   where e.teacher_id = p_teacher and e.legacy_id = ev->>'id' and e.assessment_id is distinct from a.id;
  insert into public.assessment_questions (assessment_id, teacher_id, legacy_id, number, text, passage, answer,
        standard_code, secondary_standard_code, skill, dok, costas, alignment, improvement, confidence, level, reasoning, verified, excluded, key_check, points, answer_parts, second_choice)
  select an.id, p_teacher, q->>'id', public.safe_int(q->>'number'), q->>'text', q->>'passage', q->>'answer',
         nullif(q->>'standard',''), nullif(q->>'secondary',''), nullif(q->>'skill',''),
         public.safe_int(q->>'dok'), public.safe_int(q->>'costas'), public.safe_numeric(q->>'alignment'),
         nullif(q->>'improvement',''), public.safe_numeric(q->>'confidence'), nullif(q->>'level',''),
         nullif(q->>'reasoning',''), public.safe_bool(q->>'verified'), public.safe_bool(q->>'excluded'),
                  case when jsonb_typeof(q->'keyCheck') = 'object' then q->'keyCheck' else null end,
         public.safe_numeric(q->>'points'), nullif(least(greatest(coalesce(public.safe_int(q->>'answerParts'), 1), 1), 20), 1), case when public.safe_bool(q->>'secondChoice') then true end
  from jsonb_array_elements(coalesce(p_data->'assessments','[]'::jsonb)) a
  join public.assessments an on an.teacher_id = p_teacher and an.legacy_id = a->>'id'
  cross join lateral jsonb_array_elements(coalesce(a->'questions','[]'::jsonb)) q
  where q->>'id' is not null
  on conflict (assessment_id, legacy_id) where legacy_id is not null do update set
    number = excluded.number, text = excluded.text, passage = excluded.passage, answer = excluded.answer,
    standard_code = excluded.standard_code, secondary_standard_code = excluded.secondary_standard_code,
    skill = excluded.skill, dok = excluded.dok, costas = excluded.costas, alignment = excluded.alignment,
    improvement = excluded.improvement, confidence = excluded.confidence, level = excluded.level,
    reasoning = excluded.reasoning, verified = excluded.verified, excluded = excluded.excluded,
        key_check = excluded.key_check, points = excluded.points, answer_parts = excluded.answer_parts, second_choice = excluded.second_choice, updated_at = now();
  delete from public.assessment_questions q
   using public.assessments an
   where q.assessment_id = an.id and an.teacher_id = p_teacher and q.legacy_id is not null
     and not exists (
       select 1 from jsonb_array_elements(coalesce(p_data->'assessments','[]'::jsonb)) a,
                     lateral jsonb_array_elements(coalesce(a->'questions','[]'::jsonb)) qq
        where a->>'id' = an.legacy_id and qq->>'id' = q.legacy_id);
  get diagnostics d = row_count; n_del := n_del + d;
  insert into public.student_responses (teacher_id, assessment_id, question_id, student_id, legacy_id,
        answer, correct, match_score, misconception_text, misconception_key, confidence, verified, error_type,
    final_answer, answer_region, suggested_error_type, graded_alone)
  select p_teacher, an.id, qn.id, st.id, r->>'id', r->>'answer',
         case when r->>'correct' is null then null else public.safe_bool(r->>'correct') end,
         public.safe_numeric(r->>'match'), nullif(r->>'misconception',''), nullif(r->>'misconceptionKey',''),
                  public.safe_numeric(r->>'confidence'), public.safe_bool(r->>'verified'), nullif(r->>'errorType',''),
         nullif(r->>'finalAnswer',''),
         case when jsonb_typeof(r->'answerRegion') = 'object' then r->'answerRegion' else null end,
         nullif(r->>'suggestedErrorType',''), case when public.safe_bool(r->>'gradedAlone') then true end
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
        confidence = excluded.confidence, verified = excluded.verified, error_type = excluded.error_type,
    final_answer = excluded.final_answer, answer_region = excluded.answer_region,
    suggested_error_type = excluded.suggested_error_type, graded_alone = excluded.graded_alone;
  select coalesce(array_agg(r->>'id'), '{}') into ids
    from jsonb_array_elements(coalesce(p_data->'assessments','[]'::jsonb)) a,
         lateral jsonb_array_elements(coalesce(a->'responses','[]'::jsonb)) r;
  delete from public.student_responses where teacher_id = p_teacher and legacy_id is not null and not (legacy_id = any(ids));
  get diagnostics d = row_count; n_del := n_del + d;
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
  insert into public.standards (teacher_id, jurisdiction, framework, subject, grade, code, short_label, description, domain, cluster, meta)
  select p_teacher, 'CA', coalesce(nullif(cs->>'framework',''),'Custom'), cs->>'subject', cs->>'grade', cs->>'code',
         nullif(cs->>'title',''), coalesce(nullif(cs->>'wording',''), nullif(cs->>'summary',''), cs->>'code'),
         nullif(cs->>'domain',''), nullif(cs->>'cluster',''),
         nullif((select coalesce(jsonb_object_agg(kv.key, kv.value), '{}'::jsonb)
           from jsonb_each(jsonb_strip_nulls(jsonb_build_object(
           'skills', case when jsonb_typeof(cs->'skills') = 'array' then case when jsonb_array_length(cs->'skills') > 0 then cs->'skills' end end,
           'prerequisites', case when jsonb_typeof(cs->'prerequisites') = 'array' then case when jsonb_array_length(cs->'prerequisites') > 0 then cs->'prerequisites' end end,
           'next', case when jsonb_typeof(cs->'next') = 'array' then case when jsonb_array_length(cs->'next') > 0 then cs->'next' end end,
           'vocabulary', case when jsonb_typeof(cs->'vocabulary') = 'array' then case when jsonb_array_length(cs->'vocabulary') > 0 then cs->'vocabulary' end end,
           'misconception', case when cs->>'misconception' in ('',
               'Use the student''s written reasoning to identify the step that needs support.',
               'Use the student’s written reasoning to identify the step that needs support.')
             then null else cs->>'misconception' end,
           'example', nullif(nullif(cs->>'example', ''), 'Choose a task that directly demonstrates this standard.'),
           'dok', nullif(public.safe_int(cs->>'dok'), 2),
           'source', nullif(cs->>'source', ''),
           'officialCode', nullif(cs->>'officialCode', '')))) kv
          where kv.value is distinct from cat.meta -> kv.key), '{}'::jsonb)
  from (select distinct on (coalesce(nullif(el.v->>'framework',''),'Custom'), el.v->>'grade', el.v->>'subject', el.v->>'code') el.v
          from jsonb_array_elements(coalesce(p_data->'customStandards','[]'::jsonb)) with ordinality el(v, pos)
         where el.v->>'code' is not null
         order by coalesce(nullif(el.v->>'framework',''),'Custom'), el.v->>'grade', el.v->>'subject', el.v->>'code', el.pos desc) cs_src(cs)
  left join lateral (
    select g.meta from public.standards g
     where g.teacher_id is null and g.active
       and g.code = cs->>'code' and g.framework = coalesce(nullif(cs->>'framework',''),'Custom') and g.grade = cs->>'grade'
     limit 1) cat on true
  on conflict (teacher_id, framework, grade, subject, code) where teacher_id is not null do update set
    framework = excluded.framework, subject = excluded.subject, grade = excluded.grade,
    short_label = excluded.short_label, description = excluded.description,
    domain = excluded.domain, cluster = excluded.cluster, meta = excluded.meta, updated_at = now();
  -- custom standards: the delete below matches the full key, so no list of codes is needed.
  delete from public.standards s where s.teacher_id = p_teacher and not exists (
    select 1 from jsonb_array_elements(coalesce(p_data->'customStandards','[]'::jsonb)) cs
     where cs->>'code' = s.code and coalesce(nullif(cs->>'framework',''),'Custom') = s.framework
       and cs->>'grade' = s.grade and cs->>'subject' = s.subject);
  update public.assessment_questions q set standard_id = s.id
    from public.standards s
   where q.teacher_id = p_teacher and q.standard_id is null and q.standard_code = s.code
     and (s.teacher_id is null or s.teacher_id = p_teacher);
  update public.student_evidence e set standard_id = s.id
    from public.standards s
   where e.teacher_id = p_teacher and e.standard_id is null and e.standard_code = s.code
     and (s.teacher_id is null or s.teacher_id = p_teacher);
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

CREATE OR REPLACE FUNCTION public.get_workspace_json(p_teacher uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
           'prerequisites', case when jsonb_typeof(m.meta -> 'prerequisites') = 'array'
                          then m.meta -> 'prerequisites' else '[]'::jsonb end,
           'next', case when jsonb_typeof(m.meta -> 'next') = 'array'
                          then m.meta -> 'next' else '[]'::jsonb end,
           'vocabulary', case when jsonb_typeof(m.meta -> 'vocabulary') = 'array'
                          then m.meta -> 'vocabulary' else '[]'::jsonb end,
           'misconception', coalesce(m.meta ->> 'misconception',
             'Use the student''s written reasoning to identify the step that needs support.'),
           'example', coalesce(m.meta ->> 'example',
             'Choose a task that directly demonstrates this standard.'),
           'dok', coalesce(public.safe_int(m.meta ->> 'dok'), 2),
           'source', coalesce(m.meta ->> 'source', '')) || jsonb_strip_nulls(jsonb_build_object('officialCode', m.meta ->> 'officialCode')
         ) as js
    from public.standards s
    left join lateral (
      select coalesce(
        (select g.meta from public.standards g
          where g.teacher_id is null and g.active
            and g.code = s.code and g.framework = s.framework and g.grade = s.grade
          limit 1), '{}'::jsonb) || coalesce(s.meta, '{}'::jsonb) as meta
    ) m on true
   where s.teacher_id = p_teacher or (s.teacher_id is null and s.active)
),
ws as (select data from public.teacher_workspaces where owner_id = p_teacher)
select jsonb_build_object(
  'classes', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
       'id', cid, 'name', name,
       'grade', coalesce(public.safe_int(grade), 0),
       'framework', framework,
              'demo', is_demo, 'gradingMode', grading_mode)) order by created_at, cid) from cls), '[]'::jsonb),
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
                        'assessmentId', ea.legacy_id) order by e.recorded_on, e.created_at, e.legacy_id)
          from public.student_evidence e
          left join public.assessments ea on ea.id = e.assessment_id
          where e.student_id = s.id), '[]'::jsonb)
          )) order by s.created_at, s.legacy_id) from stu s), '[]'::jsonb),
  'assessments', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
       'id', a.legacy_id, 'classId', a.class_legacy, 'classIds', to_jsonb(a.class_ids),
       'title', a.title, 'subject', a.subject,
       'grade', coalesce(public.safe_int(a.grade), 0),
       'framework', a.framework,
       'createdAt', a.created_at, 'status', a.status, 'source', a.source,
       'targetStandards', to_jsonb(a.target_standards), 'passage', a.passage,
       'answerKeyVerified', a.answer_key_verified, 'pointsPossible', a.points_possible,
       'elaArea', a.ela_area, 'genre', a.genre, 'rubric', a.rubric,
       'studentOrder', a.student_order, 'gradingMode', a.grading_mode, 'dateGiven', to_char(a.date_given, 'YYYY-MM-DD'),
       'uploadIds', coalesce(a.upload_refs -> 'uploadIds', '[]'::jsonb),
       'assignmentUploadIds', coalesce(a.upload_refs -> 'assignmentUploadIds', '[]'::jsonb),
       'answerKeyUploadIds', coalesce(a.upload_refs -> 'answerKeyUploadIds', '[]'::jsonb),
       'studentUploadIds', coalesce(a.upload_refs -> 'studentUploadIds', '{}'::jsonb),
       'questions', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'id', q.legacy_id, 'number', q.number, 'text', q.text, 'passage', q.passage, 'answer', q.answer,
            'standard', coalesce(q.standard_code, ''), 'secondary', coalesce(q.secondary_standard_code, ''),
            'skill', q.skill, 'dok', q.dok, 'costas', q.costas, 'alignment', q.alignment,
            'improvement', q.improvement, 'confidence', q.confidence, 'level', q.level,
            'reasoning', q.reasoning, 'verified', q.verified, 'excluded', q.excluded,
                        'keyCheck', q.key_check, 'points', q.points, 'answerParts', q.answer_parts, 'secondChoice', q.second_choice))
            order by q.number, q.created_at, q.legacy_id)
          from public.assessment_questions q where q.assessment_id = a.id), '[]'::jsonb),
              'responses', coalesce((select jsonb_agg(js order by ord, ord2) from (
            select r.created_at as ord, r.legacy_id as ord2, jsonb_strip_nulls(jsonb_build_object(
              'id', r.legacy_id, 'studentId', st.legacy_id, 'questionId', q.legacy_id,
              'answer', r.answer, 'correct', r.correct, 'match', r.match_score,
              'misconception', r.misconception_text, 'misconceptionKey', r.misconception_key,
                            'confidence', r.confidence, 'verified', r.verified, 'errorType', r.error_type,
              'finalAnswer', r.final_answer, 'answerRegion', r.answer_region,
              'suggestedErrorType', r.suggested_error_type, 'gradedAlone', r.graded_alone)) as js
            from public.student_responses r
            join public.students st on st.id = r.student_id
            join public.assessment_questions q on q.id = r.question_id
            where r.assessment_id = a.id
            union all
                        select ws.created_at as ord, ws.legacy_id as ord2, jsonb_strip_nulls(jsonb_build_object(
              'id', ws.legacy_id, 'studentId', st.legacy_id, 'questionId', ws.dimension_id,
              'answer', '', 'correct', ws.correct, 'match', ws.match_score,
              'rubricScore', ws.score, 'rubricReason', ws.reason,
              'confidence', ws.confidence, 'verified', ws.verified)) as js
            from public.student_writing_scores ws
            join public.students st on st.id = ws.student_id
            where ws.assessment_id = a.id
          ) merged), '[]'::jsonb)
          )) order by a.created_at, a.legacy_id) from asm a), '[]'::jsonb),
  'lessons', coalesce((select jsonb_agg(l.body order by l.created_at, l.legacy_id)
     from public.lessons l where l.teacher_id = p_teacher and l.body is not null), '[]'::jsonb),
    'resources', coalesce((select jsonb_agg(r.body order by r.created_at, r.legacy_id)
     from public.resources r where r.teacher_id = p_teacher and r.body is not null), '[]'::jsonb),
  'groups', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
       'id', g.legacy_id, 'classId', gc.legacy_id, 'name', g.name, 'standard', g.standard_code,
       'studentIds', coalesce((select jsonb_agg(st.legacy_id)
          from public.student_group_members m
          join public.students st on st.id = m.student_id
                    where m.group_id = g.id), '[]'::jsonb))) order by g.created_at, g.legacy_id)
     from public.student_groups g
     left join public.classes gc on gc.id = g.class_id
     where g.teacher_id = p_teacher), '[]'::jsonb),
    'customStandards', coalesce((select jsonb_agg(js order by created_at, code)
     from std where teacher_id = p_teacher), '[]'::jsonb),
  'sharedStandards', coalesce((select jsonb_agg(js order by framework, grade, code)
     from std where teacher_id is null), '[]'::jsonb),
  'settings', coalesce((select data -> 'settings' from ws), '{}'::jsonb),
  'activeClassId', (select data -> 'activeClassId' from ws));
$function$;
