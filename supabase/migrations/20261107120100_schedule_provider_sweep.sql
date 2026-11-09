-- Schedule the provider-retention sweep every 15 minutes (review of #203, #212 review a/e).
--
-- Mirrors how the live "purge-expired-uploads" job is wired on production:
-- pg_cron calls the edge function over pg_net, and the edge function
-- (supabase/functions/provider-sweep) POSTs to the app, which holds the OpenAI
-- key and does the deleting. The bearer below is the project's PUBLIC anon key
-- -- the same one the purge job already uses -- not a secret; the real gate is
-- the CRON_SECRET the app route checks, which the edge function adds itself.
--
-- Before this helps anything, these must exist (set by hand, not in the repo,
-- exactly as the purge job's secrets were): the deployed `provider-sweep` edge
-- function, its APP_SWEEP_URL and CRON_SECRET edge secrets, and the same
-- CRON_SECRET in the app's environment. See supabase/migrations/README.md.
--
-- NOT APPLIED by merging. Re-running cron.schedule with the same name replaces
-- the job, so this is safe to apply more than once.

set lock_timeout = '5s';

select cron.schedule(
  'sweep-provider-copies',
  -- Every 15 minutes. The app route only deletes a copy once the job is
  -- terminal or older than its one-hour lifetime and at least 30 minutes old,
  -- so a job the client never finished collecting is removed from our side
  -- within roughly 75 minutes at the outside; the provider's own
  -- abuse-monitoring copy still follows its up-to-30-day cycle.
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url := 'https://mmzbgmquhfdfqaootrvh.supabase.co/functions/v1/provider-sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1temJnbXF1aGZkZnFhb290cnZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NDU1OTQsImV4cCI6MjEwNDQyMTU5NH0.kU2S5y_PdzkEuZnNd0IMDZau9584w7xhoAAf8rY1edM'
    ),
    body := '{}'::jsonb
  );
  $cron$
);
