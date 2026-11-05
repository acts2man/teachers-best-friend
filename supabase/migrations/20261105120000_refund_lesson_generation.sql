-- One Generate = one credit (review of #199). A Generate writes the lesson in
-- Visual, Hands-on and Auditory as three requests side by side; only the
-- `full` one is charged (create_scan, gen:<scanId>), the other two and "Add
-- question" are not billable (lib/lesson-billing.ts). When any of the three
-- fails, the teacher gets the credit back -- but the client must not be able
-- to refund a lesson that worked. This function is that check, on the server:
--
--   given a run id (params->>'lessonRun', shared by the three requests), it
--   finds this teacher's own `full` lesson request of that run from the last
--   2 hours, and releases its charge gen:<scan id> only when a lesson request
--   of the same run is recorded as failed.
--
-- A confirmed charge is released by setting released_at, which every count
-- already excludes (used = released_at is null). It runs at most once: a
-- released charge is not released again. NOT applied by the author -- apply
-- by hand before merging; until then /api/lessons/refund answers "not
-- refunded" and the teacher is told so, never told a refund happened.
--
-- Proof: supabase/checks/refund-lesson-generation.sql, run by hand AFTER this
-- file; it rolls itself back.

set lock_timeout = '5s';

create or replace function public.refund_lesson_generation(
  p_teacher uuid,
  p_run text
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_full uuid;
  v_hit int;
begin
  if p_run is null or length(p_run) > 64 then
    return 0;
  end if;
  select s.id into v_full
    from public.scans s
   where s.teacher_id = p_teacher
     and s.stage = 'lesson'
     and s.params->>'lessonRun' = p_run
     and coalesce(s.params->>'lessonPart', 'full') = 'full'
     and s.created_at > now() - interval '2 hours'
   order by s.created_at
   limit 1;
  if v_full is null then
    return 0;
  end if;
  if not exists (
    select 1 from public.scans f
     where f.teacher_id = p_teacher
       and f.stage = 'lesson'
       and f.params->>'lessonRun' = p_run
       and f.status = 'failed'
  ) then
    return 0;
  end if;
  update public.page_charges c
     set released_at = now()
   where c.teacher_id = p_teacher
     and c.content_sha256 = 'gen:' || v_full::text
     and c.released_at is null;
  get diagnostics v_hit = row_count;
  return v_hit;
end;
$$;

comment on function public.refund_lesson_generation(uuid, text) is
  'Gives back the one credit of a lesson Generate when a request of the same run failed. Server-checked; see lib/lesson-billing.ts.';

revoke execute on function public.refund_lesson_generation(uuid, text) from public, anon, authenticated;
grant execute on function public.refund_lesson_generation(uuid, text) to service_role;
