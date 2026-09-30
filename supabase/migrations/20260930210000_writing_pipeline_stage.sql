-- Route the new 'writing' analyze stage on the Supabase deployment.
--
-- Writing (ELA rubric scoring) is a new AI mode. On the Supabase deployment
-- modelSettingsFor() reads routing from this table and has NO hardcoded
-- fallback -- a missing stage throws "AI pipeline is not configured." So the
-- writing stage cannot grade in production until this row exists. (The
-- ChatGPT-Sites build carries its own fixed row in sitesModelSettings.)
--
-- Writing is the one place the AI exercises judgment -- scoring an essay against
-- a rubric -- so unlike the key-based verdict stages it gets a little reasoning
-- ('low') rather than 'none'. Cheapest capable model (luna). Output is small: a
-- level and a one-line reason per rubric dimension, so 2000 tokens is ample. The
-- teacher confirms every score, so this is a suggestion, not the final grade.
insert into public.pipeline_config (stage, model, reasoning_effort, max_output_tokens, notes)
values (
  'writing',
  'gpt-5.6-luna',
  'low',
  2000,
  'ELA writing: scores one essay against the teacher''s rubric, a level + one-line reason per dimension. The one stage that uses judgment, so it runs at low reasoning; the teacher confirms every score.'
)
on conflict (stage) do update
  set model = excluded.model,
      reasoning_effort = excluded.reasoning_effort,
      max_output_tokens = excluded.max_output_tokens,
      notes = excluded.notes,
      updated_at = now();
