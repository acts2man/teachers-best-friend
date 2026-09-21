# Database migrations

These files mirror `supabase_migrations.schema_migrations` on the
**Teachers Best Friend** Supabase project, one file per applied migration,
named `<version>_<name>.sql` exactly as the remote records it.

Until this was done the repository held 2 migration files against 47 applied
on the server. The schema the whole application depends on — every table,
every RLS policy, `get_workspace_json`, `sync_workspace`, the admin views, the
metering RPCs — existed only inside the running database. It could not be
reviewed in a pull request, recreated from scratch, or diffed when something
broke. Two agents working the same project at the same time made that
concrete: a `CREATE OR REPLACE VIEW` silently dropped a `security_invoker`
flag another session had just set, and the only way to notice was to query
the live catalog.

## How these were produced

Each file's contents were read back from
`supabase_migrations.schema_migrations.statements` and written verbatim.
Every one was then checked against an MD5 taken from the database, so the
files are byte-identical to what was applied — not a re-derivation, and not
a `pg_dump` of the current shape.

## Three things to know

**`20260908054530_add_teacher_workspace_backend.sql` is not in the applied
history.** It creates `teacher_workspaces`, `teacher_uploads`, their RLS
policies and the `teacher-documents` storage bucket. Those objects exist in
production, but the migration was applied before migration tracking started,
so the remote has no record of it. It is kept here because it is the only
written account of how they were made. Do not expect
`supabase migration list` to show it.

**The history is not a clean linear design.** Several migrations replace
functions defined a few files earlier — `get_workspace_json` is defined four
times, `upsert_global_standards` three, `create_scan` four. That is what was
actually run, in the order it was run, so a replay reproduces the real
database. Read the *last* definition of anything to know its current shape.

**Three cron jobs are not represented by a file here.** `purge-expired-uploads`
(09:00 UTC), `purge-expired-student-notes` (09:15 UTC) and
`roll-expired-billing-periods` (09:30 UTC, calling
`public.roll_expired_billing_periods()`) were all scheduled from the SQL
editor, so `cron.job` is the only record of them. The functions they call do
have migrations; the schedules do not. Check `select * from cron.job` before
assuming a nightly job exists.

## Working on the schema from here

Apply changes as migrations against the project so the remote and this
directory stay in step, and commit the file in the same change as the code
that depends on it. A schema change that reaches production without a file
here puts the repository straight back where it started.

Before changing an `admin_*` view, note that `CREATE OR REPLACE VIEW` does
**not** carry `reloptions` forward, so it silently resets `security_invoker`.
Re-assert the setting and the revokes in the same migration —
`20260915013908_admin_views_definer_again_keep_grants_revoked.sql` exists
because that bit twice in one afternoon.
