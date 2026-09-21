-- Cover the foreign keys that had no index.
--
-- Irrelevant at today's size -- eighty-five students and a few dozen scans, where
-- every one of these is a sequential scan over almost nothing. They start to
-- matter in two places as the app grows: a lookup by the referenced column
-- (every assessment in a class, every response from a scan), and a delete of the
-- parent row, where Postgres has to check each child table for references and
-- does it the slow way without an index. Removing a student or a class is
-- exactly that delete, and it is a thing teachers now do from the UI.
--
-- Cheap to add now and awkward to add later under load, so they go in while the
-- tables are small enough that building them costs nothing.
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
