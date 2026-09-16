-- Adds the "class_scan" AI pipeline stage: batch-uploading a whole stack of
-- scanned student pages for one assessment, letting the model split them by
-- detected student name and grade each student's pages in one call, instead
-- of requiring a roster entry to be picked before every single upload.
-- Idempotent: safe to re-run.
insert into public.pipeline_config (stage, model, reasoning_effort, max_output_tokens, notes)
values (
  'class_scan',
  'gpt-5.6-luna',
  'low',
  12000,
  'Batch scan: splits a stack of pages by detected student name and grades each group in one call. Runs once per class scan, not once per student.'
)
on conflict (stage) do nothing;
