-- The workspace read model only ever returned each teacher's OWN standards
-- rows (teacher_id = p_teacher). Admin-unlocked shared standards
-- (teacher_id is null) were never included, so "unlock for everyone" only
-- ever pre-warmed the cache for whoever next clicked "Retrieve standards"
-- themselves -- it did not actually make them visible. Add a separate
-- sharedStandards key so every teacher sees the shared library without
-- any action, while customStandards (and what sync_workspace writes back)
-- stays exactly what it was: the teacher's own rows only.
create or replace function public.get_workspace_json(p_teacher uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
with
cls as (select c.*, c.legacy_id as cid from public.classes c where c.teacher_id = p_teacher and c.archived_at is null),
stu as (select s.*, coalesce(cl.legacy_id, s.legacy_class_id) as class_legacy
          from public.students s left join public.classes cl on cl.id = s.class_id
         where s.teacher_id = p_teacher and s.archived_at is null),
asm as (select a.*, cl.legacy_id as class_legacy
          from public.assessments a left join public.classes cl on cl.id = a.class_id
         where a.teacher_id = p_teacher and a.archived_at is null),
ws as (select data from public.teacher_workspaces where owner_id = p_teacher)
select jsonb_build_object(
  'classes', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
       'id', cid, 'name', name, 'grade', grade, 'framework', framework, 'demo', case when is_demo then true end)) order by created_at) from cls), '[]'::jsonb),
  'students', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
       'id', s.legacy_id, 'classId', s.class_legacy, 'name', s.display_label, 'fullName', s.full_name, 'color', s.color, 'notes', s.notes,
       'evidence', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'id', e.legacy_id, 'standard', e.standard_code, 'score', e.score, 'date', e.recorded_on, 'source', e.source, 'assessmentId', ea.legacy_id)) order by e.recorded_on, e.created_at)
          from public.student_evidence e left join public.assessments ea on ea.id = e.assessment_id where e.student_id = s.id), '[]'::jsonb)
     )) order by s.created_at) from stu s), '[]'::jsonb),
  'assessments', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
       'id', a.legacy_id, 'classId', a.class_legacy, 'classIds', to_jsonb(a.class_ids),
       'title', a.title, 'subject', a.subject, 'grade', a.grade, 'framework', a.framework,
       'createdAt', a.created_at, 'status', a.status, 'source', a.source,
       'targetStandards', to_jsonb(a.target_standards), 'passage', a.passage, 'answerKeyVerified', a.answer_key_verified,
       'uploadIds', coalesce(a.upload_refs -> 'uploadIds', '[]'::jsonb),
       'assignmentUploadIds', coalesce(a.upload_refs -> 'assignmentUploadIds', '[]'::jsonb),
       'answerKeyUploadIds', coalesce(a.upload_refs -> 'answerKeyUploadIds', '[]'::jsonb),
       'studentUploadIds', coalesce(a.upload_refs -> 'studentUploadIds', '{}'::jsonb),
       'questions', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'id', q.legacy_id, 'number', q.number, 'text', q.text, 'passage', q.passage, 'answer', q.answer,
            'standard', coalesce(q.standard_code, ''), 'secondary', coalesce(q.secondary_standard_code, ''),
            'skill', q.skill, 'dok', q.dok, 'costas', q.costas, 'alignment', q.alignment, 'improvement', q.improvement,
            'confidence', q.confidence, 'level', q.level, 'reasoning', q.reasoning, 'verified', q.verified, 'excluded', q.excluded)) order by q.number, q.created_at)
          from public.assessment_questions q where q.assessment_id = a.id), '[]'::jsonb),
       'responses', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'id', r.legacy_id, 'studentId', st.legacy_id, 'questionId', q.legacy_id, 'answer', r.answer, 'correct', r.correct,
            'match', r.match_score, 'misconception', r.misconception_text, 'misconceptionKey', r.misconception_key,
            'confidence', r.confidence, 'verified', r.verified)) order by r.created_at)
          from public.student_responses r join public.students st on st.id = r.student_id
          join public.assessment_questions q on q.id = r.question_id where r.assessment_id = a.id), '[]'::jsonb)
     )) order by a.created_at) from asm a), '[]'::jsonb),
  'lessons', coalesce((select jsonb_agg(l.body order by l.created_at) from public.lessons l where l.teacher_id = p_teacher and l.body is not null), '[]'::jsonb),
  'resources', coalesce((select jsonb_agg(r.body order by r.created_at) from public.resources r where r.teacher_id = p_teacher and r.body is not null), '[]'::jsonb),
  'groups', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
       'id', g.legacy_id, 'classId', gc.legacy_id, 'name', g.name, 'standard', g.standard_code,
       'studentIds', coalesce((select jsonb_agg(st.legacy_id) from public.student_group_members m join public.students st on st.id = m.student_id where m.group_id = g.id), '[]'::jsonb))) order by g.created_at)
     from public.student_groups g left join public.classes gc on gc.id = g.class_id where g.teacher_id = p_teacher), '[]'::jsonb),
  'customStandards', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
       'code', s.code, 'title', s.short_label, 'subject', s.subject, 'grade', s.grade, 'domain', s.domain, 'cluster', s.cluster,
       'wording', s.description, 'framework', s.framework)) order by s.created_at) from public.standards s where s.teacher_id = p_teacher), '[]'::jsonb),
  'sharedStandards', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
       'code', s.code, 'title', s.short_label, 'subject', s.subject, 'grade', s.grade, 'domain', s.domain, 'cluster', s.cluster,
       'wording', s.description, 'framework', s.framework)) order by s.framework, s.grade, s.code) from public.standards s where s.teacher_id is null and s.active), '[]'::jsonb),
  'settings', coalesce((select data -> 'settings' from ws), '{}'::jsonb),
  'activeClassId', (select data -> 'activeClassId' from ws));
$function$;

