create extension if not exists pg_cron;

-- Purge expired worksheet images nightly at 09:00 UTC (2am Pacific)
select cron.schedule(
  'purge-expired-uploads',
  '0 9 * * *',
  $$ select public.purge_expired_uploads(); $$
);

-- Purge expired student notes nightly at 09:15 UTC
select cron.schedule(
  'purge-expired-student-notes',
  '15 9 * * *',
  $$ select public.purge_expired_student_notes(); $$
);
