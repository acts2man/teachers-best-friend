-- Audit fixes, part 2: stop the workspace facade from emitting shapes the
-- client and the save schema reject, and stop discarding the AI-enriched
-- standard detail the catalog lookup pays to produce.
--
-- Three defects, one root cause each:
--
-- 1. jsonb_strip_nulls() removed every key whose value was null OR false.
--    * 'demo' was emitted as `case when is_demo then true end`, so a false
--      value vanished, the client read it back as undefined -> false, and
--      saved it back as false. The sample-classroom flag could never survive
--      a round trip, so the "SAMPLE CLASSROOM" banner stopped rendering and
--      fictional student data lost its label.
--    * students.color/notes and student_evidence.source/standard_code/score
--      are all nullable. When any of them was empty the key disappeared, and
--      app/api/workspace PUT validates them as required (z.string(),
--      z.number()) -- so the teacher's next save failed with a generic 400
--      and no indication of which field. Coalesce them at the source.
--
-- 2. grade is stored as text but the client compares it numerically
--    (catalogFor does `s.grade !== grade`). Emit a number and let the
--    client-side coercion in lib/teacher-server.ts be a belt, not the brace.
--
-- 3. shareCatalog() writes skills/dok/misconception/example/source into
--    standards.meta, but this function never read meta back. Every standard
--    reached the teacher with the same generic placeholder text, making the
--    catalog spend pointless. Read meta for shared rows, and for a teacher's
--    own copy fall back to the matching global row's meta (sync_workspace
--    does not persist meta on custom standards, and existing rows have none).

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
-- A standard as the client's Standard type expects it. `m` is the meta blob
-- to draw the enriched fields from: the row's own for a shared standard, the
-- matching global row's for a teacher's private copy.
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
       -- emitted unconditionally: a false here must survive the round trip
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
       'answerKeyVerified', a.answer_key_verified,
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
       'responses', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'id', r.legacy_id, 'studentId', st.legacy_id, 'questionId', q.legacy_id,
            'answer', r.answer, 'correct', r.correct, 'match', r.match_score,
            'misconception', r.misconception_text, 'misconceptionKey', r.misconception_key,
            'confidence', r.confidence, 'verified', r.verified)) order by r.created_at)
          from public.student_responses r
          join public.students st on st.id = r.student_id
          join public.assessment_questions q on q.id = r.question_id
          where r.assessment_id = a.id), '[]'::jsonb)
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

