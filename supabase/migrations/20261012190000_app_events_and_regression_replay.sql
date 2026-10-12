-- PR 1 (foundation): error logging, and the private tables the in-app
-- regression replay runs on. NOT applied by the author -- apply by hand before
-- merging the PR that adds lib/app-events*.ts and lib/regression/*.
--
-- Nothing here touches an existing table, function or policy.

------------------------------------------------------------------ app_events
-- What went wrong, where, on what device, and on which build: uncaught client
-- errors, unhandled promise rejections, failed API calls, AI calls that error,
-- time out, or come back unparseable or short, and sync failures.
--
-- It carries NO student data. The writers (lib/app-events-*.ts) send a fixed
-- set of fields; free text is passed through scrubEventText first, which cuts
-- quoted strings, emails and long digit runs and caps the length, and the
-- route is the pathname with every id replaced by ":id" and no query string.
-- The CHECKs below are the backstop on size.
--
-- A teacher can insert rows for themselves and read none. Only the service
-- role reads them (the admin pages, and anyone with database access).
create table if not exists public.app_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  teacher_id uuid references auth.users(id) on delete cascade,
  build_commit text check (char_length(build_commit) <= 64),
  route text check (char_length(route) <= 200),
  device_class text check (device_class in ('phone', 'tablet', 'desktop', 'server', 'unknown')),
  viewport_w integer check (viewport_w between 0 and 20000),
  viewport_h integer check (viewport_h between 0 and 20000),
  browser text check (char_length(browser) <= 80),
  event_type text not null check (event_type in (
    'client_error', 'unhandled_rejection', 'api_failure',
    'ai_failure', 'sync_failure', 'forced_test'
  )),
  message text check (char_length(message) <= 500),
  stack text check (char_length(stack) <= 4000),
  assessment_id text check (char_length(assessment_id) <= 80),
  scan_id text check (char_length(scan_id) <= 80),
  -- One page load. The per-session rate limit counts by it.
  session_id text check (char_length(session_id) <= 64),
  -- Small structured facts: HTTP status, AI mode/model/kind, counts. Never text
  -- a student wrote.
  detail jsonb check (pg_column_size(detail) <= 2000)
);

create index if not exists app_events_created_at_idx on public.app_events (created_at desc);
create index if not exists app_events_teacher_idx on public.app_events (teacher_id, created_at desc);
create index if not exists app_events_session_idx on public.app_events (session_id, created_at desc);

alter table public.app_events enable row level security;
revoke all on public.app_events from anon, authenticated;
grant insert on public.app_events to authenticated;

drop policy if exists "Teachers log their own events" on public.app_events;
create policy "Teachers log their own events" on public.app_events
  for insert to authenticated
  with check (teacher_id = (select auth.uid()));
-- No SELECT, UPDATE or DELETE policy: a teacher reads none of it.

-- Per-session rate limit, enforced here so a client that ignores its own cap
-- still cannot flood the table. Past 40 events in 10 minutes for one session
-- (or 200 for one teacher), further rows are dropped silently -- returning NULL
-- from a BEFORE trigger skips the insert without an error, so a logging storm
-- never turns into a stream of failed requests in the teacher's browser.
create or replace function public.app_events_rate_limit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.session_id is not null and (
    select count(*) from public.app_events
     where session_id = new.session_id and created_at > now() - interval '10 minutes'
  ) >= 40 then
    return null;
  end if;
  if new.teacher_id is not null and (
    select count(*) from public.app_events
     where teacher_id = new.teacher_id and created_at > now() - interval '10 minutes'
  ) >= 200 then
    return null;
  end if;
  return new;
end;
$$;
revoke execute on function public.app_events_rate_limit() from public, anon, authenticated;

drop trigger if exists app_events_rate_limit on public.app_events;
create trigger app_events_rate_limit before insert on public.app_events
  for each row execute function public.app_events_rate_limit();

-- Kept 30 days, like every other operational log here.
select cron.schedule(
  'purge-app-events',
  '50 9 * * *',
  $cron$ delete from public.app_events where created_at < now() - interval '30 days' $cron$
);

------------------------------------------------------------------ regression replay
-- Real cases, replayed inside the app through the same code and the live
-- pipeline_config the founders get, to measure each AI change before and after.
-- All of it is private: RLS on, no policy for anon, and the authenticated
-- policies below admit only accounts on regression_admins. The app reaches
-- these tables with the service role, after the server-side gate in
-- lib/regression/gate.ts.

-- Who may see the replay page and call its route. Being an admin is not
-- enough; an admin is added here by hand (see docs/regression-replay.md).
create table if not exists public.regression_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text check (char_length(note) <= 200),
  added_at timestamptz not null default now()
);
alter table public.regression_admins enable row level security;
revoke all on public.regression_admins from anon, authenticated;

create or replace function public.is_regression_admin(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.regression_admins where user_id = p_user)
     and public.is_admin(p_user);
$$;
revoke execute on function public.is_regression_admin(uuid) from public, anon, authenticated;

-- The same check for the caller only, so an RLS policy can use it without
-- letting anyone ask about another account.
create or replace function public.i_am_regression_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_regression_admin((select auth.uid()));
$$;
revoke execute on function public.i_am_regression_admin() from public, anon;
grant execute on function public.i_am_regression_admin() to authenticated;

-- Which assessments' photos may be copied and kept as test fixtures. A row here
-- means the teacher said yes for THIS assessment; consent_note records who, when
-- and where. Deleting the row deletes its fixtures and cases (cascade) -- the
-- stored files are removed by the "revoke" admin action, which deletes them
-- through the Storage API before the row.
create table if not exists public.regression_fixture_allowlist (
  teacher_id uuid not null references auth.users(id) on delete cascade,
  assessment_legacy_id text not null check (char_length(assessment_legacy_id) <= 80),
  consent_note text not null check (char_length(consent_note) between 5 and 500),
  added_by uuid references auth.users(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (teacher_id, assessment_legacy_id)
);
alter table public.regression_fixture_allowlist enable row level security;
revoke all on public.regression_fixture_allowlist from anon, authenticated;

-- A copied photo. The file lives in the private regression-fixtures bucket,
-- under <teacher_id>/<assessment_legacy_id>/<source upload id>. It is NOT a
-- teacher_uploads row, so the 30-day upload purge (which works from
-- teacher_uploads and uploads) never sees it; account deletion removes it
-- (lib/account-deletion-server.ts).
create table if not exists public.regression_fixtures (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null,
  assessment_legacy_id text not null,
  source_upload_id uuid not null,
  -- 'page' = a whole graded page; 'name_strip' = the name-area copy the name
  -- pass reads; 'worksheet' / 'answer_key' = the blank test or key pages.
  role text not null check (role in ('page', 'name_strip', 'worksheet', 'answer_key')),
  position integer not null check (position >= 0),
  object_path text not null unique,
  content_sha256 text,
  mime text not null,
  size_bytes integer,
  copied_at timestamptz not null default now(),
  unique (teacher_id, assessment_legacy_id, source_upload_id),
  foreign key (teacher_id, assessment_legacy_id)
    references public.regression_fixture_allowlist (teacher_id, assessment_legacy_id)
    on delete cascade
);
alter table public.regression_fixtures enable row level security;
revoke all on public.regression_fixtures from anon, authenticated;

-- One thing to check on one assessment, with what the teacher confirmed in the
-- app as the expected answer. `code` is the only label the replay page shows.
create table if not exists public.regression_cases (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^case-[a-z0-9]{4,12}$'),
  teacher_id uuid not null,
  assessment_legacy_id text not null,
  kind text not null check (kind in ('names', 'answer_reading', 'grouping', 'answer_key', 'standards')),
  expected jsonb not null,
  -- Where the expected values came from, e.g. "teacher-confirmed in app, snapshot 2026-10-12".
  source text not null check (char_length(source) <= 200),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (teacher_id, assessment_legacy_id)
    references public.regression_fixture_allowlist (teacher_id, assessment_legacy_id)
    on delete cascade
);
alter table public.regression_cases enable row level security;
revoke all on public.regression_cases from anon, authenticated;

create table if not exists public.regression_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  started_by uuid references auth.users(id) on delete set null,
  build_commit text,
  -- Exactly what pipeline_config said when the run started.
  pipeline_config jsonb not null,
  status text not null default 'running' check (status in ('running', 'finished', 'abandoned')),
  summary jsonb
);
alter table public.regression_runs enable row level security;
revoke all on public.regression_runs from anon, authenticated;

-- One row per case per run: its result, and the runner's progress while it is
-- in flight (which AI job is running), so a request can pick up where the last
-- one stopped.
create table if not exists public.regression_run_cases (
  run_id uuid not null references public.regression_runs(id) on delete cascade,
  case_id uuid not null references public.regression_cases(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'running', 'passed', 'failed', 'error')),
  state jsonb not null default '{}'::jsonb,
  -- Per-stage accuracy, answers read vs expected on multi-part questions, etc.
  metrics jsonb,
  cost_usd numeric(12, 6) not null default 0,
  model text,
  effort text,
  error text check (char_length(error) <= 500),
  updated_at timestamptz not null default now(),
  primary key (run_id, case_id)
);
alter table public.regression_run_cases enable row level security;
revoke all on public.regression_run_cases from anon, authenticated;

-- Admins on the allow-list may read results directly; nobody else reads any of
-- these, and nobody but the service role writes.
grant select on public.regression_runs, public.regression_run_cases to authenticated;
drop policy if exists "Regression admins read runs" on public.regression_runs;
create policy "Regression admins read runs" on public.regression_runs
  for select to authenticated using ((select public.i_am_regression_admin()));
drop policy if exists "Regression admins read run cases" on public.regression_run_cases;
create policy "Regression admins read run cases" on public.regression_run_cases
  for select to authenticated using ((select public.i_am_regression_admin()));

-- The private bucket. No storage.objects policy is created for it, so only the
-- service role can read or write a fixture.
insert into storage.buckets (id, name, public)
values ('regression-fixtures', 'regression-fixtures', false)
on conflict (id) do nothing;
