-- Cover the foreign keys that had no index, and stop one RLS policy
-- re-evaluating auth.uid() per row.
--
-- Both are irrelevant at today's size -- eighty-five students, a few dozen
-- scans -- and both get awkward to add later under load. They matter in two
-- places as the app grows: a lookup by the referenced column (every assessment
-- in a class, every response from a scan), and a delete of the parent row,
-- where Postgres checks each child table for references and does it the slow
-- way without an index. Removing a student or clearing a roster is exactly that
-- delete, and it is a thing teachers now do from the UI.
create index if not exists admin_audit_log_actor_idx          on public.admin_audit_log (actor_id);
create index if not exists assessment_standards_standard_idx  on public.assessment_standards (standard_id);
create index if not exists assessment_standards_teacher_idx   on public.assessment_standards (teacher_id);
create index if not exists assessments_class_idx              on public.assessments (class_id);
create index if not exists impersonation_sessions_teacher_idx on public.impersonation_sessions (teacher_id);
create index if not exists lessons_class_idx                  on public.lessons (class_id);
create index if not exists pipeline_config_model_idx          on public.pipeline_config (model);
create index if not exists scans_class_idx                    on public.scans (class_id);
create index if not exists scans_upload_idx                   on public.scans (upload_id);
create index if not exists student_evidence_assessment_idx    on public.student_evidence (assessment_id);
create index if not exists student_evidence_standard_fk_idx   on public.student_evidence (standard_id);
create index if not exists student_group_members_teacher_idx  on public.student_group_members (teacher_id);
create index if not exists student_groups_class_idx           on public.student_groups (class_id);
create index if not exists student_responses_reteaching_idx   on public.student_responses (reteaching_id);
create index if not exists student_responses_scan_idx         on public.student_responses (scan_id);
create index if not exists support_messages_teacher_idx       on public.support_messages (teacher_id);

-- The insert policy on support_tickets called auth.uid() per row, so it was
-- re-evaluated for every row rather than once for the statement. A scalar
-- subquery lets the planner evaluate it a single time. Same rule, same result.
do $$
declare
  body text;
begin
  select pg_get_expr(pol.polwithcheck, pol.polrelid)
    into body
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
   where c.relname = 'support_tickets' and pol.polname = 'tickets_own_insert';

  if body is not null and body like '%auth.uid()%' and body not like '%( SELECT auth.uid()%' then
    execute 'alter policy tickets_own_insert on public.support_tickets with check ('
      || replace(body, 'auth.uid()', '(select auth.uid())') || ')';
  end if;
end $$;
