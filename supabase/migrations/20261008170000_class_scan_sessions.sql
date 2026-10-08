-- A class scan in progress, saved to the teacher's account so it follows them
-- between devices.
--
-- Michael scanned his class on his phone, opened the computer, and saw nothing:
-- the in-progress scan (which pages, grouped into which students, how far
-- grading got, the name matches) lived only in the phone's localStorage. This
-- table holds that same state server-side, one row per teacher per assessment,
-- so the computer can show it and carry on. The phone keeps its local copy as a
-- backup for when it is offline.
--
-- What a row holds: upload ids of the scanned pages in scan order, the
-- teacher's student boundaries, grading progress (which batches are done, the
-- id of a batch still running), the name each page was read as and the
-- student it was matched to, and which device is grading right now. No image
-- bytes -- the photographs stay in Storage under their own retention.
--
-- When it is cleared (docs/student-data-flow.md, "Things to re-check"):
--   - by the app, the moment the teacher saves the graded class or starts over;
--   - on its own after 7 days (expires_at): the app ignores an expired row and
--     deletes it on the teacher's next write, and the nightly purge job below
--     removes any that nobody came back for. 7 days matches the local draft's
--     lifetime and is well inside the 30-day upload window;
--   - with the account: the row cascades from auth.users, which account
--     deletion removes.
--
-- Written only through /api/scans/session with the service role, scoped to the
-- signed-in teacher. RLS is on, with own-row policies, as defence in depth.

create table if not exists public.class_scan_sessions (
  teacher_id uuid not null references auth.users(id) on delete cascade,
  -- The app's assessment id (assessments.legacy_id), which is what the client
  -- knows. Not a foreign key: a session may be started before the assessment's
  -- first save reaches the relational tables.
  assessment_id text not null,
  state jsonb not null,
  revision integer not null default 1,
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  primary key (teacher_id, assessment_id)
);

alter table public.class_scan_sessions enable row level security;

do $rls$
begin
  if not exists (select 1 from pg_policy where polname = 'class_scan_sessions_own_select') then
    create policy class_scan_sessions_own_select on public.class_scan_sessions
      for select using (teacher_id = (select auth.uid()));
    create policy class_scan_sessions_own_insert on public.class_scan_sessions
      for insert with check (teacher_id = (select auth.uid()));
    create policy class_scan_sessions_own_update on public.class_scan_sessions
      for update using (teacher_id = (select auth.uid())) with check (teacher_id = (select auth.uid()));
    create policy class_scan_sessions_own_delete on public.class_scan_sessions
      for delete using (teacher_id = (select auth.uid()));
  end if;
end $rls$;

-- Sessions nobody came back for. Runs with the other nightly purges.
do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'purge-expired-class-scan-sessions',
      '30 9 * * *',
      $job$delete from public.class_scan_sessions where expires_at < now()$job$
    );
  end if;
end $cron$;
