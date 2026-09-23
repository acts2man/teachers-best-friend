-- A scan cannot exist uncharged.
--
-- What happened: a teacher spent nine days on a Netlify deploy permalink, a
-- complete copy of an OLD production build carrying the production service key.
-- It had no page ledger, so its scans ran against this database and charged
-- nothing -- 25 of them on 2026-09-22 with no charge_pages row, no
-- content_sha256, no build stamp. The charge lived in the route, so any caller
-- that did not call charge_pages got free scans. That is precisely what a stale
-- copy of the app is: a caller that does not know about the charge.
--
-- The fix moves enforcement out of the route and into the one function every
-- scan must pass through. Two designs were weighed:
--
--   (a) create_scan itself performs the charge, so a scan cannot exist
--       uncharged; the charge and the scan row are one transaction.
--   (b) a required deploy identifier every scan must record, with create_scan
--       refusing a scan that has none.
--
-- (a) is implemented. (b) proves which build ran, but it does not make the
-- charge happen: a copy that records a build id and still skips charge_pages
-- gets free scans, so (b) cannot deliver "counting no copy can skip". And a
-- build id is not durable containment -- the next permalink WILL carry one.
-- Under (a) the charge is a structural precondition of the scan's existence:
-- the only way to mint a scan row is this function, and for a billable,
-- charging-mode request it charges first, atomically, so there is no ordering a
-- caller can choose that yields a billable scan with no charge. (We still record
-- the build ref here -- attribution is useful -- we just do not rely on it for
-- enforcement.)
--
-- Everything charge_pages already guarantees is preserved, because create_scan
-- now CALLS charge_pages rather than reimplementing it: name_strip and catalog
-- never charge, a page is charged once per teacher forever, failed pages are
-- released, the whole stack is all-or-nothing, an abandoned reservation lapses
-- after two hours, and admin catalog work is exempt from the per-teacher cap
-- but still counted in the platform total. The reserve-up-front path is
-- untouched: charge_pages is idempotent, so a pre-reserved stack is already
-- paid when create_scan charges its batch, and nothing is billed twice.

-- ---------------------------------------------------------------
-- What a scan is billed against, recorded on the scan row.
-- ---------------------------------------------------------------
-- The content hashes (or the generation key) whose page_charges rows back this
-- scan. Stored here so the invariant "a billable, complete scan has an
-- attributable charge" is answerable by a single query, and stays answerable
-- after the upload rows are purged: page_charges and this column both key on
-- the content hash, which outlives the file on purpose.
alter table public.scans add column if not exists charge_keys text[];
comment on column public.scans.charge_keys is
  'Content hashes (or gen:<scan> key) whose page_charges rows back this scan. Null on free-mode/non-billable scans and on scans predating this column. supabase/checks/pages-charged.sql asserts every billable, complete, charging-mode scan since enforcement has a live charge for each key.';

-- ---------------------------------------------------------------
-- create_scan now performs the charge.
-- ---------------------------------------------------------------
-- Signature change: a single p_upload_id becomes p_upload_ids uuid[] (the pages
-- this scan bills), and p_build_ref is recorded at birth.
--
-- Zero-downtime, deliberately: this is added as an OVERLOAD, and the old
-- single-upload signature is NOT dropped here. There is a window between
-- applying this migration and the new code going live where the currently
-- deployed (old) code still calls create_scan with p_upload_id; that call must
-- keep resolving to the old function or every scan errors mid-deploy. The two
-- overloads are unambiguous -- the pages argument is uuid vs uuid[] -- so old
-- callers hit the old function and new callers hit this one. Once the new code
-- is live the old, uncharged signature is dropped by the follow-up migration
-- 20260923170500_drop_legacy_uncharged_create_scan.sql, which is applied after
-- the deploy is confirmed. Until then Part 1's host guard is what keeps a stale
-- copy from reaching the old signature at all.
create or replace function public.create_scan(
  p_teacher uuid,
  p_class_id uuid default null,
  p_student_id uuid default null,
  p_assessment_id uuid default null,
  p_upload_ids uuid[] default null,
  p_billable boolean default true,
  p_stage text default null,
  p_build_ref text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id      uuid := gen_random_uuid();
  v_status  text;
  v_gen_key text;
  v_keys    text[];
begin
  -- A suspended account never reaches the model, charged or not.
  select status into v_status from public.profiles where id = p_teacher;
  if v_status is distinct from 'active' then
    raise exception 'ACCOUNT_SUSPENDED: teacher %', p_teacher using errcode = 'check_violation';
  end if;

  -- The charge is the precondition of the scan's existence. A billable request
  -- in a charging mode is charged here, in this transaction, before the row is
  -- written. charge_pages raises (SCAN_QUOTA_EXCEEDED / NO_SUBSCRIPTION /
  -- UPLOAD_NOT_FOUND) without writing when the stack does not fit or an upload
  -- is not this teacher's, and that raise rolls this whole call back: no scan
  -- row, so no uncharged scan can exist. Free modes (name_strip, catalog) and
  -- non-billable calls (admin catalog refresh) skip the charge exactly as the
  -- routes did.
  if p_billable
     and p_stage is distinct from 'name_strip'
     and p_stage is distinct from 'catalog' then
    if coalesce(array_length(p_upload_ids, 1), 0) = 0 then
      -- No page (a generated lesson or passage): charge 1 against a key unique
      -- to this scan. The scan id is minted up front so that key exists now.
      v_gen_key := 'gen:' || v_id::text;
    end if;

    perform public.charge_pages(p_teacher, p_upload_ids, p_stage, v_gen_key);

    if v_gen_key is not null then
      v_keys := array[v_gen_key];
    else
      -- The same key charge_pages uses: the content hash, or upload:<id> when a
      -- row somehow has no hash (it should not -- see the insert trigger below).
      select array_agg(distinct coalesce(u.content_sha256, 'upload:' || u.id::text))
        into v_keys
        from unnest(p_upload_ids) as t(uid)
        join public.teacher_uploads u on u.id = t.uid
       where u.owner_id = p_teacher;
    end if;
  end if;

  insert into public.scans (
    id, teacher_id, class_id, student_id, assessment_id,
    billable, status, stage, charge_keys, build_ref_start
  )
  values (
    v_id, p_teacher, p_class_id, p_student_id, p_assessment_id,
    p_billable, 'queued', p_stage, v_keys, p_build_ref
  );
  return v_id;
end $$;

comment on function public.create_scan(uuid, uuid, uuid, uuid, uuid[], boolean, text, text) is
  'Opens a scan row AND performs its page charge in one transaction: a billable, charging-mode request is charged (all-or-nothing) before the row exists, so a scan cannot exist uncharged. Records charge_keys and the build ref. name_strip/catalog and non-billable calls skip the charge. Raises SCAN_QUOTA_EXCEEDED / NO_SUBSCRIPTION / UPLOAD_NOT_FOUND / ACCOUNT_SUSPENDED without writing.';

revoke execute on function public.create_scan(uuid, uuid, uuid, uuid, uuid[], boolean, text, text) from public, anon, authenticated;
grant execute on function public.create_scan(uuid, uuid, uuid, uuid, uuid[], boolean, text, text) to service_role;

-- ---------------------------------------------------------------
-- Every uploaded page must carry its content hash from the start.
-- ---------------------------------------------------------------
-- content_sha256 is the ledger's identity for a page: it is what stops the same
-- bytes being charged twice, and what create_scan records as charge_keys. The
-- 25 uncounted scans came in with null hashes. Going forward a Supabase upload
-- must have one.
--
-- Enforced with a BEFORE INSERT trigger, not a CHECK constraint, on purpose:
-- the nightly retention purge UPDATEs old rows (sets purged_at), and some of
-- those old rows have null hashes. A CHECK -- even NOT VALID -- is re-checked on
-- UPDATE and would block the purge. A trigger scoped to INSERT enforces new
-- uploads without touching the purge of old ones. (The Sites/Cloudflare build
-- writes a different table entirely and is unaffected.)
create or replace function public.teacher_uploads_require_hash()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.content_sha256 is null then
    raise exception 'UPLOAD_HASH_REQUIRED: content_sha256 must be set at upload time'
      using errcode = 'not_null_violation';
  end if;
  return new;
end $$;

drop trigger if exists teacher_uploads_require_hash on public.teacher_uploads;
create trigger teacher_uploads_require_hash
  before insert on public.teacher_uploads
  for each row
  execute function public.teacher_uploads_require_hash();

comment on function public.teacher_uploads_require_hash() is
  'Refuses a teacher_uploads INSERT with a null content_sha256. INSERT only, so the retention purge (which UPDATEs old, possibly null-hash rows) is unaffected. supabase/checks/uploads-hashed.sql asserts no post-fix row is null.';
