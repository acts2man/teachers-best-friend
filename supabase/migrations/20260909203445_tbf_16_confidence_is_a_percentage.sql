-- The prototype stores confidence and alignment as 0-100 percentages,
-- not 0-1 probabilities. Match that rather than silently rescaling data.
alter table public.assessment_questions
  alter column confidence type numeric(5,2);

alter table public.student_responses
  alter column confidence type numeric(5,2);

comment on column public.assessment_questions.confidence is
  'Percentage 0-100. Keep one scale across the app — do not mix with 0-1.';
comment on column public.assessment_questions.alignment is
  'Percentage 0-100.';
comment on column public.student_responses.confidence is
  'Percentage 0-100.';
