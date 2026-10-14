-- Not a migration. Run by hand AFTER
-- supabase/migrations/20261014120000_atomic_workspace_revision.sql has been
-- applied.
--
-- What it proves (gap G4, rule R7 in docs/system-map.md): the revision check
-- and the write are one atomic step.
--   PART 1 (one session, rolls itself back):
--     (1) a save carrying the CURRENT revision is written and bumps it;
--     (2) a save carrying the OLD revision is refused (null) and writes
--         nothing -- the revision and the row counts do not move;
--     (3) a save for a teacher with no workspace row is refused and creates
--         nothing.
--   PART 2 (two sessions, by hand): the race. Two saves carrying the SAME
--     revision; the second waits on the row lock and is refused once the
--     first commits. Session B rolls back; session A commits (use a test account).
--
-- Safe on production: no DDL. PART 1 runs inside a DO block that raises at
-- the end, so the transaction rolls back and nothing it saved survives. The
-- final ERROR line IS the result -- read it, it is not a failure.
--
-- Set the teacher below to an account that has a workspace -- ideally your
-- own test account, not a pilot teacher's. The block holds that teacher's
-- rows for the moment it runs; lock_timeout stops it waiting on anyone else.

-- =====================================================================
-- PART 1: single session
-- =====================================================================

set lock_timeout = '5s';
set statement_timeout = '30s';

do $check$
declare
  tid uuid := '00000000-0000-0000-0000-000000000000'; -- <-- set this
  nobody uuid := gen_random_uuid();                    -- has no workspace row
  ws jsonb;
  rev0 bigint;
  saved bigint;
  rev1 bigint;
  stale bigint;
  rev2 bigint;
  missing bigint;
  missing_rows int;
  before_counts jsonb;
  after_counts jsonb;
  counts text := $q$
    select jsonb_build_object(
      'classes',     (select count(*) from public.classes where teacher_id = $1),
      'students',    (select count(*) from public.students where teacher_id = $1),
      'assessments', (select count(*) from public.assessments where teacher_id = $1),
      'responses',   (select count(*) from public.student_responses where teacher_id = $1))
  $q$;
begin
  select revision into rev0 from public.teacher_workspaces where owner_id = tid;
  if rev0 is null then raise exception 'NO_WORKSPACE for %', tid; end if;
  ws := public.get_workspace_json(tid);

  -- (1) the current revision: written, and the revision moves on by one.
  saved := public.sync_workspace_if_revision(tid, ws, rev0);
  select revision into rev1 from public.teacher_workspaces where owner_id = tid;

  -- (2) the OLD revision (rev0) again: refused. To prove it writes nothing,
  -- the payload drops every student -- if it were written, the counts would fall.
  execute counts into before_counts using tid;
  stale := public.sync_workspace_if_revision(tid, jsonb_set(ws, '{students}', '[]'), rev0);
  execute counts into after_counts using tid;
  select revision into rev2 from public.teacher_workspaces where owner_id = tid;

  -- (3) no workspace row: refused, and no row is created.
  missing := public.sync_workspace_if_revision(nobody, ws, 0);
  select count(*) into missing_rows from public.teacher_workspaces where owner_id = nobody;

  raise exception 'ROLLED_BACK expect saved=rev0+1=rev1, stale=null, rev2=rev1, equal counts, missing=null, missing_rows=0 | got rev0=% saved=% rev1=% stale=% rev2=% missing=% missing_rows=% | counts before=% after=%',
    rev0, saved, rev1, coalesce(stale::text, 'null'), rev2,
    coalesce(missing::text, 'null'), missing_rows, before_counts, after_counts;
end
$check$;

-- =====================================================================
-- PART 2: the race, two sessions (e.g. two SQL editor tabs or two psql
-- windows). Run the steps in order, switching windows where it says.
-- Replace <TEACHER> with the same teacher id as above. Session B ends in
-- ROLLBACK; session A commits a re-save of the unchanged workspace.
--
-- Use your own TEST account here: step A2 commits (see below).
--
-- Expected: B's call in step B1 HANGS until A finishes (it is waiting on the
-- teacher_workspaces row lock). After A commits in step A2, B returns NULL:
-- it re-read the row, saw revision N+1, and refused. Before this fix, both
-- calls would have returned a revision and B's whole-workspace replace would
-- have deleted what A added.
--
-- (A2 uses COMMIT to show the real behaviour; step A3 says what that leaves
-- behind. If you would rather not commit on production at all, use ROLLBACK in
-- A2 instead: B then sees revision N unchanged, succeeds, and the point shown
-- is only that B WAITED -- then ROLLBACK B as well.)
-- =====================================================================

-- ---------------------------------------------------------------------
-- SESSION A, step A1
-- ---------------------------------------------------------------------
-- set lock_timeout = '5s';
-- begin;
-- select revision as n from public.teacher_workspaces where owner_id = '<TEACHER>';
-- -- use that N below
-- select public.sync_workspace_if_revision('<TEACHER>',
--          public.get_workspace_json('<TEACHER>'), <N>);   -- returns N+1
-- -- do NOT commit yet; switch to session B

-- ---------------------------------------------------------------------
-- SESSION B, step B1
-- ---------------------------------------------------------------------
-- set lock_timeout = '60s';   -- long enough to wait for A
-- begin;
-- select public.sync_workspace_if_revision('<TEACHER>',
--          public.get_workspace_json('<TEACHER>'), <N>);   -- HANGS here
-- -- leave it hanging; switch to session A

-- ---------------------------------------------------------------------
-- SESSION A, step A2
-- ---------------------------------------------------------------------
-- commit;
-- -- switch to session B: its call has now returned NULL (refused)

-- ---------------------------------------------------------------------
-- SESSION B, step B2
-- ---------------------------------------------------------------------
-- select revision from public.teacher_workspaces where owner_id = '<TEACHER>';  -- N+1
-- rollback;

-- ---------------------------------------------------------------------
-- SESSION A, step A3 (only if A2 committed): A re-saved the same workspace,
-- so the only lasting change is revision N -> N+1. Any open browser tab for
-- this teacher will get one 409 and reload; nothing else needs undoing.
-- ---------------------------------------------------------------------
