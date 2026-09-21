-- Pin the search_path on the percent-scale functions.
--
-- Flagged by Supabase's security linter: a function with a mutable search_path
-- resolves unqualified names against whatever the caller has set, so a caller
-- who puts their own schema first can decide what `round()` means. These three
-- run inside triggers on every write to assessment_questions and
-- student_responses, which makes them the wrong place to leave that open.
create or replace function public.percent_scale(value numeric)
returns numeric language sql immutable
set search_path = pg_catalog, public
as $$
  select case
    when value is null then null
    when value > 0 and value <= 1 then round(value * 100)
    else value
  end
$$;

create or replace function public.questions_force_percent_scale()
returns trigger language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.alignment  := public.percent_scale(new.alignment);
  new.confidence := public.percent_scale(new.confidence);
  return new;
end $$;

create or replace function public.responses_force_percent_scale()
returns trigger language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.match_score := public.percent_scale(new.match_score);
  new.confidence  := public.percent_scale(new.confidence);
  return new;
end $$;
