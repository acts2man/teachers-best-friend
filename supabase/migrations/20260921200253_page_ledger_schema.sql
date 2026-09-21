-- One scan = one page the teacher photographs or uploads.
--
-- Until now a "scan" was a row in public.scans, which is roughly one model
-- call, and the route decided billability per request. That made the price of
-- the same work depend on how we happened to split it: a class set of 30
-- papers billed about 1 scan, because only the first grading batch was
-- billable and the name-strip pass never was. Splitting differently would have
-- changed the bill without changing anything the teacher did.
--
-- The unit is now the page. A student paper, an answer key, a blank
-- assignment, a roster photo: each counts once, the first time it is sent to a
-- charging mode. Our own passes over a page the teacher already paid for --
-- the name-strip privacy pass, the continuation batches -- are free, and so is
-- a re-grade of the same page tomorrow.
--
-- "Never charged twice" is not a rule the routes have to remember. It is the
-- unique (teacher_id, content_sha256) constraint below. Whatever calls in --
-- the sync path, the background poll replaying stored params, a client
-- resuming an interrupted class set, a teacher pressing grade again -- lands
-- on the same row for the same bytes. Getting it wrong would require
-- inserting a duplicate the database will not accept.
--
-- public.scans is untouched and keeps its job: the per-model-call cost log.
-- Cost and quota answer different questions, which is what they always meant.
--
-- Existing usage starts at zero under this ledger: nothing that has already
-- been scanned has a page_charges row. That affects the four accounts on the
-- project today, all of them ours or a pilot teacher's.

-- page_count is decided server-side at upload time. The browser is not asked:
-- a PDF's page count is the number of pages the teacher is charged for, so it
-- is not a number the client gets a vote on. Images are 1.
alter table public.teacher_uploads
  add column if not exists page_count int not null default 1;

alter table public.teacher_uploads
  drop constraint if exists teacher_uploads_page_count_range;
alter table public.teacher_uploads
  add constraint teacher_uploads_page_count_range
  check (page_count between 1 and 200);

-- sha256 of the bytes. This, not the upload id, is what identifies a page:
-- the class-scan flow uploads the same photograph twice (the body crop and
-- the name strip are separate rows), a teacher can upload the same file
-- twice, and an upload row is deleted on its retention schedule while the
-- charge has to outlive it.
alter table public.teacher_uploads
  add column if not exists content_sha256 text;

comment on column public.teacher_uploads.page_count is
  'Pages in this upload, counted server-side at upload time. Images are 1; a PDF is parsed. Never taken from the client.';
comment on column public.teacher_uploads.content_sha256 is
  'sha256 of the uploaded bytes. Identifies a page for billing, so the same file uploaded twice is charged once.';

create table if not exists public.page_charges (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users (id) on delete cascade,
  -- Deliberately no foreign key. Upload rows are purged on their retention
  -- schedule and when a teacher confirms grading; the charge history has to
  -- survive that, or deleting a photograph would refund the page.
  upload_id uuid,
  content_sha256 text not null,
  pages int not null check (pages > 0),
  mode text not null,
  reserved_at timestamptz not null default now(),
  confirmed_at timestamptz,
  released_at timestamptz,
  unique (teacher_id, content_sha256)
);

comment on table public.page_charges is
  'One row per page a teacher has ever been charged for. The unique constraint on (teacher_id, content_sha256) is what makes double-charging impossible rather than merely avoided.';
comment on column public.page_charges.upload_id is
  'The upload this was charged for, for tracing only. No FK: upload rows are deleted and the charge must outlive them.';
comment on column public.page_charges.released_at is
  'Set when a reservation is given back after a failure or a cancelled stack. Only ever set on an unconfirmed row: a page graded successfully once is not refunded by a later failure.';

create index if not exists page_charges_teacher_period_idx
  on public.page_charges (teacher_id, reserved_at)
  where released_at is null;

alter table public.page_charges enable row level security;

drop policy if exists page_charges_own_select on public.page_charges;
create policy page_charges_own_select on public.page_charges
  for select to authenticated
  using (teacher_id = (select auth.uid()));

-- No insert/update/delete policy for authenticated on purpose. A teacher can
-- read what they were charged and nothing else; only the definer functions
-- write, and the routes reach those through the service client.
revoke all on public.page_charges from public, anon;
grant select on public.page_charges to authenticated;
grant all on public.page_charges to service_role;
