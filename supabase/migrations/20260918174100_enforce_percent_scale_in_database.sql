-- Alignment and confidence are percentages. Enforce that here, not in the app.
--
-- This is the third time these columns have been written as 0-1 fractions and
-- rendered as "0.85%" to a teacher. The application-tier repair (pctField in
-- lib/analyze-shared.ts) is correct and provably converts 0.85 to 85 when run
-- against the repo's source -- and production kept storing 0.85 anyway, with
-- the deployed commit confirmed current. Whatever the reason (a stale cached
-- function bundle is the leading suspect), an invariant that a teacher sees
-- cannot depend on which build happens to be serving a request.
--
-- So it moves to the one place every writer must pass through. Any path that
-- inserts or updates these rows -- the current app, an older cached bundle,
-- the Cloudflare build, a manual fix, a future rewrite -- is corrected on the
-- way in.
--
-- The rule, unchanged from 20260915005023 and 20260917221500: a value greater
-- than 0 and at most 1 is a fraction and is scaled. The pipeline emits a flat 0
-- when there is no match, so a genuine 1%-or-less score does not arise. 0 stays
-- 0, and anything already above 1 is left alone, which makes this idempotent.

create or replace function public.percent_scale(value numeric)
returns numeric language sql immutable as $$
  select case
    when value is null then null
    when value > 0 and value <= 1 then round(value * 100)
    else value
  end
$$;

comment on function public.percent_scale(numeric) is
  'Coerces a 0-1 fraction to a 0-100 percentage. Idempotent: values above 1 and 0 itself pass through.';

create or replace function public.questions_force_percent_scale()
returns trigger language plpgsql as $$
begin
  new.alignment  := public.percent_scale(new.alignment);
  new.confidence := public.percent_scale(new.confidence);
  return new;
end $$;

create or replace function public.responses_force_percent_scale()
returns trigger language plpgsql as $$
begin
  new.match_score := public.percent_scale(new.match_score);
  new.confidence  := public.percent_scale(new.confidence);
  return new;
end $$;

drop trigger if exists assessment_questions_percent_scale on public.assessment_questions;
create trigger assessment_questions_percent_scale
  before insert or update of alignment, confidence on public.assessment_questions
  for each row execute function public.questions_force_percent_scale();

drop trigger if exists student_responses_percent_scale on public.student_responses;
create trigger student_responses_percent_scale
  before insert or update of match_score, confidence on public.student_responses
  for each row execute function public.responses_force_percent_scale();

-- Bring the rows written since the last rescale onto the same scale.
update public.assessment_questions
   set alignment = alignment
 where alignment is not null and alignment <= 1 and alignment > 0;

update public.assessment_questions
   set confidence = confidence
 where confidence is not null and confidence <= 1 and confidence > 0;

update public.student_responses
   set match_score = match_score
 where match_score is not null and match_score <= 1 and match_score > 0;

update public.student_responses
   set confidence = confidence
 where confidence is not null and confidence <= 1 and confidence > 0;
