-- Retire the 'minimal' reasoning effort.
--
-- Why: every model this app routes to now (gpt-5.4-nano, gpt-5.6-luna and the
-- rest) rejects reasoning effort 'minimal' with a 400, and that 400 takes the
-- whole request down. That is what broke batch grading's name pass for a pilot
-- teacher (Ricky): the name_strip stage was configured 'minimal', so reading
-- the names off a scanned stack failed before any grading could start. PR #70
-- added a code-side backstop (providerEffort coerces 'minimal' -> 'low'); this
-- migration removes 'minimal' at the source so the backstop never has to fire.
--
-- The live name_strip row was quietly changed from 'minimal' to 'low' after
-- Ricky's failures with no record of who or when, because a raw console UPDATE
-- bypasses admin_set_pipeline (which is the only path that stamps updated_at
-- and writes the audit log). Part 3 below closes that gap for the future.

-- ---------------------------------------------------------------
-- 1. Rewrite any row still on 'minimal'.
-- ---------------------------------------------------------------
-- Today that is only the 'embedding' row, and changing it is safe: it is a
-- placeholder the app never calls (see app/admin/pipeline/page.tsx, where it is
-- in the UNUSED set, and lib/pipeline-config.ts, which is only read by the
-- analyze pipeline). Real embeddings use text-embedding-3-small, which is not a
-- reasoning model and is never sent a reasoning-effort value, so the row's
-- effort has no runtime effect. It is rewritten only so the row satisfies the
-- tightened constraint below. The WHERE clause is written generically so it
-- also catches any other row that predates this migration.
update public.pipeline_config
   set reasoning_effort = 'low', updated_at = now()
 where reasoning_effort = 'minimal';

-- ---------------------------------------------------------------
-- 2. Tighten the CHECK so 'minimal' can never be saved again.
-- ---------------------------------------------------------------
-- The original inline constraint allowed ('minimal','low','medium','high') and,
-- notably, never allowed 'none' even though the app treats it as valid. Replace
-- it with the set the app actually supports now.
alter table public.pipeline_config
  drop constraint if exists pipeline_config_reasoning_effort_check;
alter table public.pipeline_config
  add constraint pipeline_config_reasoning_effort_check
  check (reasoning_effort in ('none', 'low', 'medium', 'high'));

-- The column still defaulted to 'minimal', so a future insert that omitted the
-- effort would now violate the constraint. Default to the floor these models
-- accept instead.
alter table public.pipeline_config
  alter column reasoning_effort set default 'low';

-- ---------------------------------------------------------------
-- 3. Record future edits.
-- ---------------------------------------------------------------
-- admin_set_pipeline stamps updated_at and writes the audit log, but a raw SQL
-- UPDATE in the Supabase console does neither -- which is how the name_strip
-- change went unrecorded. A BEFORE UPDATE trigger bumps updated_at on every
-- change, whatever the path, so at least "when" a stage last changed is always
-- true. (Reuses the shared public.touch_updated_at() already used by profiles,
-- subscriptions and others.)
drop trigger if exists pipeline_config_touch on public.pipeline_config;
create trigger pipeline_config_touch
  before update on public.pipeline_config
  for each row execute function public.touch_updated_at();
