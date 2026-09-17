-- The "name_strip" stage: reading the name off the cropped top band of a
-- scanned page, on its own, so the request that grades the work never carries
-- a student's name beside that student's answers.
--
-- Runs once per whole-class stack, alongside class_scan. It is not billed to a
-- teacher's scan quota -- both calls are one teacher action -- so it is
-- recorded with billable = false and is excluded from "average cost per scan"
-- for the same reason internal runs are.
--
-- Cheapest work in the app: a narrow image, a few words out, no reasoning.
-- Idempotent: safe to re-run.
insert into public.pipeline_config (stage, model, reasoning_effort, max_output_tokens, notes)
values (
  'name_strip',
  'gpt-5.4-nano',
  'minimal',
  1500,
  'Reads the student name off the cropped top band of each scanned page. Shown no questions, no answer key and no student work, so identity and answers never travel in the same request. Runs once per class scan; not billed to quota.'
)
on conflict (stage) do nothing;
