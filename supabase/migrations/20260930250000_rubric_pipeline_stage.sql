-- Route the new 'rubric' analyze stage on the Supabase deployment.
--
-- "Upload your own rubric" is a new AI mode: a teacher photographs or uploads
-- their writing rubric and the model turns it into structured traits (name, top
-- score, descriptor, and a suggested standard per trait) for the teacher to
-- confirm. On the Supabase deployment modelSettingsFor() reads routing from this
-- table and has NO hardcoded fallback -- a missing stage throws "AI pipeline is
-- not configured" -- so the rubric read cannot run in production until this row
-- exists. (The ChatGPT-Sites build carries its own fixed row in
-- sitesModelSettings.)
--
-- A small, one-off read the teacher reviews and edits: the cheapest capable
-- model (luna) at low reasoning, with room for a dozen traits and their
-- descriptors (4000 tokens).
insert into public.pipeline_config (stage, model, reasoning_effort, max_output_tokens, notes)
values (
  'rubric',
  'gpt-5.6-luna',
  'low',
  4000,
  'ELA writing: reads a teacher''s own rubric (photo or PDF) into traits with a descriptor and a suggested standard each. A one-off read the teacher confirms and edits.'
)
on conflict (stage) do update
  set model = excluded.model,
      reasoning_effort = excluded.reasoning_effort,
      max_output_tokens = excluded.max_output_tokens,
      notes = excluded.notes,
      updated_at = now();
