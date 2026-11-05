-- Not a migration. Run by hand AFTER
-- supabase/migrations/20261105120000_refund_lesson_generation.sql and
-- 20261106120000_refund_only_on_failed_version.sql have been applied. Safe on production: every write is inside a DO block that raises at
-- the end, so the transaction rolls back and nothing it wrote survives. The
-- final ERROR line IS the result -- read it, it is not a failure.
--
-- What it proves: a lesson Generate whose other VERSION (lessonPart flow)
-- failed is refunded once; one whose only failure is an Add question
-- (lessonPart question) is not; one whose siblings all worked is not; an unknown run, another
-- teacher's run, or one older than 2 hours is not; a second refund does
-- nothing.
--
-- Set the teacher below to a test account (ideally your own). It writes made-up
-- scan and charge rows for that teacher only, and rolls them back.

set lock_timeout = '5s';
set statement_timeout = '30s';

do $check$
declare
  tid uuid := '00000000-0000-0000-0000-000000000000'; -- <-- set this
  other uuid := gen_random_uuid();
  run_bad text := gen_random_uuid()::text;
  run_ok text := gen_random_uuid()::text;
  full_bad uuid := gen_random_uuid();
  full_ok uuid := gen_random_uuid();
  flow_bad uuid := gen_random_uuid();
  old_full uuid := gen_random_uuid();
  run_old text := gen_random_uuid()::text;
  run_q text := gen_random_uuid()::text;
  full_q uuid := gen_random_uuid();
  r_q int;
  flow_old uuid := gen_random_uuid();
  r_bad int; r_again int; r_ok int; r_flow int; r_other int; r_old int;
  used_before int; used_after int;
begin
  insert into public.scans (id, teacher_id, stage, status, billable, params, created_at) values
    (full_bad, tid, 'lesson', 'complete', true, jsonb_build_object('mode','lesson','lessonPart','full','lessonRun',run_bad), now()),
    (flow_bad, tid, 'lesson', 'failed', false, jsonb_build_object('mode','lesson','lessonPart','flow','lessonRun',run_bad), now()),
    (full_ok, tid, 'lesson', 'complete', true, jsonb_build_object('mode','lesson','lessonPart','full','lessonRun',run_ok), now()),
    (full_q, tid, 'lesson', 'complete', true, jsonb_build_object('mode','lesson','lessonPart','full','lessonRun',run_q), now()),
    (gen_random_uuid(), tid, 'lesson', 'failed', false, jsonb_build_object('mode','lesson','lessonPart','question','lessonRun',run_q), now()),
    (old_full, tid, 'lesson', 'complete', true, jsonb_build_object('mode','lesson','lessonPart','full','lessonRun',run_old), now() - interval '3 hours'),
    (flow_old, tid, 'lesson', 'failed', false, jsonb_build_object('mode','lesson','lessonPart','flow','lessonRun',run_old), now() - interval '3 hours');
  insert into public.page_charges (teacher_id, content_sha256, pages, mode, reserved_at, confirmed_at) values
    (tid, 'gen:' || full_bad::text, 1, 'lesson', now(), now()),
    (tid, 'gen:' || full_ok::text, 1, 'lesson', now(), now()),
    (tid, 'gen:' || full_q::text, 1, 'lesson', now(), now()),
    (tid, 'gen:' || old_full::text, 1, 'lesson', now() - interval '3 hours', now() - interval '3 hours');
  select count(*) into used_before from public.page_charges where teacher_id = tid and released_at is null;

  r_other := public.refund_lesson_generation(other, run_bad);
  r_bad := public.refund_lesson_generation(tid, run_bad);
  r_again := public.refund_lesson_generation(tid, run_bad);
  r_ok := public.refund_lesson_generation(tid, run_ok);
  r_flow := public.refund_lesson_generation(tid, gen_random_uuid()::text);
  r_old := public.refund_lesson_generation(tid, run_old);
  r_q := public.refund_lesson_generation(tid, run_q);
  select count(*) into used_after from public.page_charges where teacher_id = tid and released_at is null;

  raise exception 'ROLLED_BACK expect failed_run=1 again=0 worked_run=0 unknown_run=0 other_teacher=0 older_than_2h=0 failed_question_only=0 used_down_by=1 | got % % % % % % % %',
    r_bad, r_again, r_ok, r_flow, r_other, r_old, r_q, used_before - used_after;
end
$check$;
