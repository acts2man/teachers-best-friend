-- Let a read be reused only when the next request would ask the model for
-- exactly the same thing.
--
-- Reading a document is a pure function of its bytes AND of what it was asked:
-- the mode, the subject, grade and framework, the intended standards, and the
-- prompt itself. reuse_fingerprint stores all of that (see readReuseFingerprint
-- in lib/analyze-server.ts), folding in a READ_PROMPT_VERSION that is bumped
-- whenever a read prompt changes. A later read is served from a stored result
-- only when its fingerprint matches exactly, so a different grade, a different
-- set of intended standards, or a newer prompt is a miss and a fresh read.
--
-- Nullable and unstamped on every existing row: scans written before this
-- column never match a fingerprint, so none of them is ever reused -- which is
-- correct, since they were produced by an older prompt.
alter table public.scans
  add column if not exists reuse_fingerprint text;

-- The reuse lookup is "the most recent complete, billable scan for this teacher
-- with this fingerprint", so index the teacher + fingerprint pair. Partial on
-- the rows the lookup can actually return keeps it small.
create index if not exists scans_reuse_fingerprint_idx
  on public.scans (teacher_id, reuse_fingerprint)
  where reuse_fingerprint is not null and status = 'complete';

comment on column public.scans.reuse_fingerprint is
  'Identical-read key: v<READ_PROMPT_VERSION>|mode|subject|grade|framework|sorted intended standards|sorted page content hashes. A read is reused only on an exact match; a prompt change bumps the version and invalidates every stored read.';
