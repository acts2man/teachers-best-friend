-- Background (asynchronous) analysis support.
-- Additive, nullable columns on scans so a single scan can carry the in-flight
-- provider job and its finished, validated result. Untouched by the synchronous
-- path; safe to apply ahead of enabling ANALYZE_ASYNC.
alter table public.scans
  add column if not exists provider_response_id text,
  add column if not exists provider_model text,
  add column if not exists params jsonb,
  add column if not exists result jsonb;
