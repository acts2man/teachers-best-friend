-- Record which build of the app served each scan.
--
-- Twice now a fix has been confirmed correct in the repo, confirmed merged, and
-- confirmed deployed -- and the database kept showing the old behaviour. The
-- gap is that "deployed" was measured at /api/version, a small, new serverless
-- function, while the work happens in /api/analyze, a large, long-lived one.
-- Nothing proved those two were the same build.
--
-- Two columns, because the two halves of a scan run in different functions and
-- can be stale independently:
--   build_ref_start   set by /api/analyze when the scan is created
--   build_ref_finish  set by /api/analyze/[scanId] where finalizeAnalysis runs
--
-- If they disagree with each other, or with `git rev-parse origin/main`, the
-- deploy is not what it claims and no amount of reading the source will show
-- it. This turns every future scan into its own evidence, so the next time a
-- teacher reports something that "should already be fixed", one query answers
-- whether the fix was running.

alter table public.scans add column if not exists build_ref_start  text;
alter table public.scans add column if not exists build_ref_finish text;

comment on column public.scans.build_ref_start is
  'COMMIT_REF of the build that created this scan (/api/analyze). Null on builds predating this column.';
comment on column public.scans.build_ref_finish is
  'COMMIT_REF of the build that wrote this scan''s result (/api/analyze/[scanId]). Compare with build_ref_start and with origin/main.';
