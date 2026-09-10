-- Background (asynchronous) analysis support.
--
-- The scans row already reserves quota and records token usage. These columns
-- let a single scan also carry the in-flight provider job and its finished,
-- validated result, so the client can poll /api/analyze/{scanId} instead of
-- holding a serverless function open past its platform timeout.
--
-- All columns are nullable and unused by the synchronous path, so this
-- migration is additive and safe to apply ahead of enabling the feature.
--
--   provider_response_id  the OpenAI Responses id to poll while status =
--                         'analyzing'; deleted once the result is read.
--   provider_model        the resolved model, recorded so usage/cost can be
--                         attributed when the poll route finalizes the scan.
--   params                the original analyze request, replayed to validate
--                         and reconcile the model output.
--   result                the finalized result object the client persists.
alter table public.scans
  add column if not exists provider_response_id text,
  add column if not exists provider_model text,
  add column if not exists params jsonb,
  add column if not exists result jsonb;
