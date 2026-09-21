-- The insert policy on support_tickets called auth.uid() per row, so it was
-- re-evaluated for every row instead of once for the statement. Wrapping it in
-- a scalar subquery lets the planner evaluate it a single time. Same rule,
-- same result; it only stops the work being repeated.
do $$
declare
  body text;
begin
  select pg_get_expr(pol.polwithcheck, pol.polrelid)
    into body
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
   where c.relname = 'support_tickets' and pol.polname = 'tickets_own_insert';

  if body is not null and body like '%auth.uid()%' and body not like '%( SELECT auth.uid()%' then
    execute 'alter policy tickets_own_insert on public.support_tickets with check ('
      || replace(body, 'auth.uid()', '(select auth.uid())') || ')';
  end if;
end $$;
