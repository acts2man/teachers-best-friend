-- The "passage" stage: reading a story or article into text, once, so that
-- every student's grading can carry the whole thing.
--
-- A reading-comprehension answer cannot be marked honestly without the text it
-- is about. Attaching the photographed pages to each student would pay to read
-- the same story once per child -- for a ten-page story and a class of 150,
-- paying 150 times for something that needs doing once. Reading it once and
-- sending the text instead costs a fraction, and every student gets the full
-- story rather than none of it.
--
-- Runs once per assessment, not once per student, so it is not billed against a
-- teacher's scan quota. Needs a large output ceiling because a whole short
-- story has to come back in one piece.
insert into public.pipeline_config (stage, model, reasoning_effort, max_output_tokens, notes)
values (
  'passage',
  'gpt-5.6-luna',
  'minimal',
  24000,
  'Transcribes a photographed story or article into plain text, once per assessment. Shown no questions, no answer key, no student work and no roster -- it is asked to transcribe, not to answer. The text is kept on the assessment and travels with every student''s grading thereafter.'
)
on conflict (stage) do nothing;
