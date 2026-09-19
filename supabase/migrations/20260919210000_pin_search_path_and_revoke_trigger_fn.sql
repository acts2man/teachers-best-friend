-- Two findings from the security linter, both applied to production.
--
-- 1. The percent-scale functions had a mutable search_path. A function that
--    resolves unqualified names against whatever the caller has set lets that
--    caller decide what `round()` means. These three run inside triggers on
--    every write to assessment_questions and student_responses, which makes
--    them the wrong place to leave that open.
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

-- 2. block_write_while_impersonating() is a trigger function, but it was
--    reachable by name through /rest/v1/rpc, where being SECURITY DEFINER meant
--    it ran with the definer's rights. Postgres still fires it as a trigger
--    after EXECUTE is revoked, so this costs nothing and closes the route.
revoke execute on function public.block_write_while_impersonating() from public, anon, authenticated;
