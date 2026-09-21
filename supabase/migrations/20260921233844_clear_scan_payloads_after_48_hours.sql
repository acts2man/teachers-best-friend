-- Student work stopped living in the cost log.
--
-- public.scans.params holds the request that was sent for a background
-- analysis; public.scans.result holds what came back. For stage 'responses'
-- that result carries questions, responses and title -- a transcription of
-- what a child wrote. Both exist for exactly one reason: a background job
-- finishes later, and GET /api/analyze/{scanId} has to be able to hand the
-- teacher the result when it does.
--
-- Nothing else reads either column. Not a view, not a database function, not
-- the admin pages -- getTeacherScans selects cost, token, model and status
-- columns by name. Checked against pg_proc and information_schema.views, not
-- assumed.
--
-- Nothing cleared them afterwards either, so a scan from 11 September still
-- held a child's answers, and deleting that student in the app left them
-- behind: outside every retention rule the Data Processing Addendum states.
--
-- Delivery is over long before 48 hours. A background job that has not
-- returned inside one sitting is not going to. So 48 hours after the scan was
-- created, params, result and error are set to NULL.
--
-- error is in that list because it can carry content too. It stores up to 500
-- characters of AiCallError.detail, which is "openai <where> <status>: " plus
-- the first 400 characters of the provider's own response body, and a 400 from
-- the provider can quote the part of the request it objected to -- and our
-- request carries the transcribed reading passage and whatever the teacher
-- typed. Every error in the table today is a teacher-facing sentence with
-- nothing in it ("This document needs a smaller batch. Try fewer pages."), so
-- this is about the path that exists rather than damage already done. The
-- durable fact -- that the scan failed -- is in status, which is untouched.
--
-- 'catalog' is exempt. It loads a state's published standards into the shared
-- library: no student data goes into it, and keeping its params makes a re-run
-- diffable against the one before.
--
-- Everything that makes a scan row a financial record is untouched: cost_usd,
-- every token count, both model names, created_at, completed_at, status,
-- attempts, billable and billing_period.

create or replace function public.purge_scan_payloads(p_hours int default 48)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_rows int;
begin
  update public.scans
     set params = null,
         result = null,
         error  = null
   where created_at < now() - make_interval(hours => p_hours)
     -- `is distinct from` rather than `<> 'catalog'`: rows written before the
     -- stage column existed carry NULL, and `<>` would silently skip every one
     -- of them -- which is the half of the table holding the oldest results.
     and stage is distinct from 'catalog'
     and (params is not null or result is not null or error is not null);
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

comment on function public.purge_scan_payloads(int) is
  'Clears params, result and error on scans older than p_hours (48 by default), for every stage except catalog. Keeps every cost, token, model, timing and status column: the row stays a financial record and stops being a copy of a child''s work.';

revoke execute on function public.purge_scan_payloads(int) from public, anon, authenticated;
grant  execute on function public.purge_scan_payloads(int) to service_role;

-- Nightly, 09:45 UTC, after the uploads purge (09:00), the student-notes purge
-- (09:15) and the billing roll (09:30). Unscheduled first so re-running this
-- migration does not leave two jobs doing the same work.
select cron.unschedule(jobid) from cron.job where jobname = 'purge-scan-payloads';
select cron.schedule('purge-scan-payloads', '45 9 * * *', $cron$ select public.purge_scan_payloads(); $cron$);

-- And once now, so the rows that are already past 48 hours are cleared today
-- rather than tonight.
select public.purge_scan_payloads();
