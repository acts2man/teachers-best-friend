-- Review of #199: refund_lesson_generation gave the credit back when ANY
-- lesson request of the run failed. Two of those were wrong:
--   - lessonPart "question" (Add question) never carries the run id today,
--     but nothing on the server stopped one that did from refunding a lesson
--     that was delivered;
--   - lessonPart "full" failing already released its own charge (the analyze
--     route settles a failed request), so a "refund" of it had nothing to do.
-- Now only a failed lessonPart "flow" of the same run -- one of the other two
-- versions -- refunds the run's full-lesson credit. Everything else is
-- unchanged. Replaces the function from 20261105120000 (same signature).
-- NOT applied by the author -- apply by hand, after 20261105120000.
--
-- Proof: supabase/checks/refund-lesson-generation.sql (updated), run by hand
-- AFTER this file; it rolls itself back.

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
  -- Only a failed other VERSION of this Generate (lessonPart "flow"). Not
  -- "question": Add question is free and separate, and a failed one must not
  -- give back a lesson that was delivered. Not "full": a failed full request
  -- released its own credit already, when it failed.
  if not exists (
    select 1 from public.scans f
     where f.teacher_id = p_teacher
       and f.stage = 'lesson'
       and f.params->>'lessonRun' = p_run
       and f.params->>'lessonPart' = 'flow'
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
  'Gives back the one credit of a lesson Generate when one of its other versions (lessonPart flow) failed. Server-checked; see lib/lesson-billing.ts.';

revoke execute on function public.refund_lesson_generation(uuid, text) from public, anon, authenticated;
grant execute on function public.refund_lesson_generation(uuid, text) to service_role;
