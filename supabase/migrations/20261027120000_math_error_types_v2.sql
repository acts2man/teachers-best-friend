-- Ricky's new Math error list (Slack, 24 Oct 2026; lib/error-types.ts). The old
-- five tags ("Algebraic/Arithmetic error", "Sign error", "Conceptual/Setup
-- error", "Wrong formula", "Graph/Table interpretation error") are not on it.
-- Ricky agreed to clearing them; grades are untouched. Nothing is lost: every
-- old tag and old AI suggestion on a Math (or Mixed, which uses the Math list)
-- answer is copied into legacy_error_type / legacy_suggested_error_type first,
-- then cleared.
--
-- The legacy columns are not part of the workspace: sync_workspace's upsert
-- never names them, so a later save keeps them, and get_workspace_json never
-- returns them. No function is patched. A typed "Other" label is stored in
-- error_type as "Other: <label>", which both functions already carry.
--
-- Idempotent: only the old five names are moved, so running it again (after
-- the deploy, to catch a tag an old tab made in between) moves only those.
-- Each teacher whose answers changed gets their workspace revision bumped, so
-- a tab still holding the old tags gets a 409 on its next save instead of
-- writing them back.
--
-- NOT applied by the author. Apply by hand AFTER the deploy (or before and
-- again after). Proof: supabase/checks/math-error-types-v2.sql, run by the
-- reviewer BEFORE this file -- it runs this file's statements and rolls back.

set lock_timeout = '5s';

alter table public.student_responses
  add column if not exists legacy_error_type text,
  add column if not exists legacy_suggested_error_type text;

with old(name) as (
  values ('Algebraic/Arithmetic error'), ('Sign error'), ('Conceptual/Setup error'),
         ('Wrong formula'), ('Graph/Table interpretation error')
), moved as (
  update public.student_responses r set
    legacy_error_type = case when r.error_type in (select name from old)
      then r.error_type else r.legacy_error_type end,
    legacy_suggested_error_type = case when r.suggested_error_type in (select name from old)
      then r.suggested_error_type else r.legacy_suggested_error_type end,
    error_type = case when r.error_type in (select name from old) then null else r.error_type end,
    suggested_error_type = case when r.suggested_error_type in (select name from old)
      then null else r.suggested_error_type end
  from public.assessments a
  where a.id = r.assessment_id
    and a.subject in ('Math', 'Mixed')
    and (r.error_type in (select name from old) or r.suggested_error_type in (select name from old))
  returning r.teacher_id
)
update public.teacher_workspaces w set revision = w.revision + 1
where w.owner_id in (select distinct teacher_id from moved);
