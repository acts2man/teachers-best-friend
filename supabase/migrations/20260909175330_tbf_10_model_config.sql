-- ---------------------------------------------------------------
-- MODEL ROUTING CONFIG
-- Which model runs which stage lives in data, not in OPENAI_MODEL.
-- You can retune cost without a deploy, and every change is visible
-- next to the cost telemetry it affects.
-- ---------------------------------------------------------------
create table if not exists public.pipeline_config (
  stage            text primary key,
  model            text not null references public.model_pricing(model),
  reasoning_effort text not null default 'minimal'
                     check (reasoning_effort in ('minimal','low','medium','high')),
  max_output_tokens integer not null default 2000,
  notes            text,
  updated_at       timestamptz not null default now()
);

insert into public.pipeline_config (stage, model, reasoning_effort, max_output_tokens, notes) values
  ('assignment',  'gpt-5.6-terra', 'low',     3000,
   'Reads the worksheet, assigns standards. ~8x/month per teacher, so quality is worth more here than cost. Benchmark sol if accuracy is short.'),
  ('answer_key',  'gpt-5.6-luna',  'minimal', 1500,
   'Reads the answer key. Straight extraction.'),
  ('responses',   'gpt-5.6-luna',  'minimal', 1200,
   'THE VOLUME CALL — once per student per assessment. Grading against a supplied key is comparison, not reasoning. Benchmark luna first; fall back to terra only if accuracy fails.'),
  ('reteaching',  'gpt-5.6-terra', 'low',     2500,
   'Generates reteaching material. Fires ONLY on a library cache miss.'),
  ('lesson',      'gpt-5.6-terra', 'low',     2500, 'Lesson plan generation.'),
  ('catalog',     'gpt-5.6-sol',   'medium',  8000,
   'Standards recall for states/grades with no stored catalog. Stopgap — load real standards instead.'),
  ('roster',      'gpt-5.6-luna',  'minimal', 800,
   'Reads names off a roster photo. Image deleted immediately after.'),
  ('support',     'gpt-5.6-luna',  'minimal', 800,
   'First-line ticket answering.'),
  ('embedding',   'gpt-5.4-nano',  'minimal', 1,
   'Placeholder row. Actual embeddings use text-embedding-3-small (1536 dims), billed separately.')
on conflict (stage) do nothing;

alter table public.pipeline_config enable row level security;
-- No policies: service role only.

comment on table public.pipeline_config is
  'Stage -> model routing. The responses stage is the volume driver:
   ~1,200 calls/month for a secondary teacher vs ~8 for assignment.
   Optimize responses first, always.';
