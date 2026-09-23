# Student data flow

Internal record. Not a published policy page, but the published pages must stay
consistent with it. Update this file whenever a hop, a vendor, or a retention window
changes.

Last verified against the running system: 2026-09-23.

---

## The hops

```
Teacher's browser
  └─(1)─> Netlify (Next.js app)
            ├─(2)─> Supabase Postgres        (rosters, questions, scores, mastery)
            ├─(3)─> Supabase Storage         (uploaded images and PDFs)
            └─(4)─> OpenAI Responses API     (analysis of the uploaded work)
                      └─(5)─> back to the app, then to the teacher
```

Confirming a student's grading deletes that student's scanned pages straight away.
A daily job (6) sweeps up anything still left once its retention window passes.

Metering records a SHA-256 of each uploaded file's bytes (`teacher_uploads.content_sha256`,
carried into `page_charges`) so the same page is never charged twice. It is a hash, not a
copy: it identifies the bytes and cannot be turned back into them, it stays inside Supabase
Postgres, and it is never sent to OpenAI. The charge row outlives the image on purpose --
deleting a photograph must not hand back a page that was already graded -- so a hash of a
page can remain after the page itself is gone.

---

## 1. Browser to application

| Question | Answer |
|---|---|
| What is transmitted | Teacher credentials, roster entries, uploaded files, teacher corrections |
| Encrypted | Yes, TLS |
| Stored here | No. Netlify functions are stateless; nothing persists on the node |
| Retained | Duration of the request |
| Used for training | No |
| Other use | No |
| Deletable | Not applicable, nothing is retained |

Cross-origin writes are rejected by an origin allow-list (`guardOrigin`), and every
request is authenticated against the teacher's Supabase session.

## 2. Application to Postgres

| Question | Answer |
|---|---|
| What is transmitted | Roster labels, question text, answer keys, scores, standards, misconceptions, teacher notes |
| Encrypted | Yes, TLS in transit and at rest on disk |
| Stored here | Yes, this is the system of record |
| Retained | While the account is active; teacher notes may carry an earlier expiry; grading results held for delivery are cleared 48 hours after the scan |
| Used for training | No |
| Other use | No |
| Deletable | Yes, per student, class, assessment, or whole account |
| Backups | Supabase automated backups, purged within the documented backup window |

Row-level security scopes every table to the owning teacher, so one teacher's data is
unreachable from another teacher's session even if the application layer had a bug.

Metering also records, on each scan row, the content hashes it was billed against
(`scans.charge_keys`, matching `teacher_uploads.content_sha256` / `page_charges`). These
are hashes, not copies: they identify the bytes, stay inside Supabase Postgres, and are
never sent to OpenAI. They are stored so "a billable scan has an attributable charge"
stays answerable by query after the upload row is purged.

### Every deploy runs with the full production environment, and its permalink never expires

Netlify keeps a permanent, immutable URL for every deploy
(`https://<deploy-id>--teachersbestfriend.netlify.app`). That URL is a **complete copy of
that build's serverless functions running with the production environment**, which
includes `SUPABASE_SERVICE_ROLE_KEY` — the key that bypasses every row-level-security
policy above. A permalink is therefore a fully usable copy of the app with unrestricted
read/write access to the production database, reachable by anyone who has the link, for
as long as the deploy exists. A stale permalink was used against production for nine days
(see `docs/incident-response.md`).

What contains it: the host guard (`lib/canonical-host.ts`) refuses any production request
whose host is not `CANONICAL_HOST`, so a permalink of any build **from the guard onward**
is inert. It cannot reach into permalinks of older builds, so deleting old deploys and
limiting Netlify's deploy retention remain necessary for those.

### Grading results held for delivery (`scans.params`, `scans.result`)

A background analysis stores the request it sent and the result it got back on the
`scans` row, because the job finishes after the request that started it has ended and
`GET /api/analyze/{scanId}` has to have something to hand the teacher when they come
back. For a `responses` scan that result is a transcription of what a child wrote.

Nothing else reads either column -- not a view, not a database function, not the admin
pages, which select the cost and token columns by name. They are a delivery buffer, and
they were kept forever: a scan from 11 September still held a student's answers, and
deleting that student in the app left them behind.

**Cleared 48 hours after the scan**, along with `scans.error`, by
`purge-scan-payloads` (step 6). `catalog` scans are exempt: they carry a state's
published standards, not student work. Everything that makes the row a financial
record -- cost, tokens, models, timings, status -- is kept, which is the point: what
survives an account is a receipt, not a copy of a child's work.

### Deleting the whole account

`POST /api/account/delete`, from Settings, confirmed by typing the account's email
address. It cancels any payment subscription first and stops if that fails, removes
every uploaded file through the Storage API, then deletes every row the teacher owns --
profile, classes, students, assessments, questions, evidence, responses, groups,
lessons, resources, custom standards, workspace, support threads, subscription, page
charges -- and finally the sign-in itself.

`scans` is the one exception, and it is deliberate: its `teacher_id` is set to NULL and
its params, result and error are cleared, so the cost of work we already paid for
survives as a row that names nobody. One line goes in the admin audit log recording that
an account on a given plan was deleted, carrying no email and no name.

An admin can run the identical function from the account page for a district's deletion
request (DPA Section 7). An admin "viewing as" a teacher cannot: writes are refused for
the whole of a view-as session, and this is the last place to make an exception.

## 3. Application to Storage

| Question | Answer |
|---|---|
| What is transmitted | Photographs and PDFs of assessments and completed student work |
| Encrypted | Yes, TLS in transit, encrypted at rest |
| Stored here | Bucket `teacher-documents`, private, no public URLs |
| Retained | Until the teacher confirms that student's grading, which deletes the pages immediately; **30 days from upload** at the outside, then deleted by the job in step 6 |
| Used for training | No |
| Other use | No |
| Deletable | Yes: immediately by the teacher, automatically on confirming that student's grading, and automatically at 30 days |

Object paths are namespaced by owner (`<teacher id>/<upload id>`) and the bucket is not
public, so a file is reachable only through an authenticated, authorised request.

## 4. Application to OpenAI

This is the hop districts ask about, so it is the most specific.

| Question | Answer |
|---|---|
| What is transmitted | The uploaded work, grade level, subject, the relevant standards, question IDs, and -- where the teacher has uploaded one -- the transcribed text of the shared reading passage |
| What is **not** transmitted | The class roster or any student list, teacher name, school name, district name. No student name is sent as text |
| Name read from the image | Single-student mode: no. Whole-class stack scan: a separate request reads the cropped name band alone; the request that grades the work is sent the page with that band removed, so no request holds a name and that student's answers together |
| Encrypted | Yes, TLS |
| Stored there | Per the OpenAI API data policy for API traffic |
| Retained | Per that policy; not used to build a profile for us |
| Used for training | No. API data is excluded from training by OpenAI's API terms |
| Other use | No |
| Deletable | The request payload is not something we can recall once sent, which is exactly why identity is stripped before it leaves |

Endpoint: `https://api.openai.com/v1/responses`.

The grading prompt instructs the model not to reproduce student names, and the
application sends a question ID rather than a student identity. The honest limit,
stated in the published pages too: the image itself is a photograph of a child's work
and may carry a name the student wrote on the page. We minimise identifiers, we do not
claim uploads are anonymous.

### Whole-class stack scan (`class_scan`)

This mode grades a stack of pages from many students in one pass, so something in the
request has to say which page belongs to whom.

**What it used to do (16–17 Sep 2026).** It sent the entire class roster as a list of
names and asked the model to match each page against it. That contradicted the "not
transmitted" row above and three published pages. It shipped without this file being
re-checked, which is the failure this section exists to prevent repeating.

**What it does now.** No roster is sent. `rosterNames` was removed from the accepted
request parameters, so a stale client cannot reintroduce it, and it no longer reaches
`scans.params` either. The model transcribes only the name written on the page it is
already looking at, and matching to a student record happens locally in
`matchRosterStudent()` (`lib/teacher-class-scan.ts`).

**Split identification from grading (18 Sep 2026).** The page is cut in the browser
before anything is uploaded. The top band — `NAME_BAND`, 18% of page height, in
`lib/image-prep.ts` — goes to a `name_strip` request carrying no questions, no answer key
and no roster. Everything below it goes to the `class_scan` request, which is shown no
name and is told which pages belong together, worked out by the app from the strips
(`groupPagesByName`). The bands do not overlap by construction, so a name written on the
boundary cannot ride into the grading request; `bandGeometry` is tested for that.

Matching a transcribed name to a student happens only in the app, in
`matchRosterStudent()`. Neither request is ever sent the roster.

`tests/prompt-separation.test.mjs` asserts this against the prompts the app actually
builds, so an edit that quietly puts a name back into the grading call fails the suite.

**The honest limit that remains.** A name written outside the top band — in a margin, or
partway down the page — stays in the image sent for grading. The band is a fixed
fraction, not a detector. The exposure is one name on one page rather than a roster, and
it is not linked to a student record by anything in that request, but it is not zero and
should not be described as zero.

**Fallback.** A PDF, or a browser that cannot do the cut, sends the whole page to grading
and reads no name from it; the teacher names that group by hand. That path trades the
split for a page with a name on it, so it behaves exactly as the pre-split scan did.

### Shared reading passage (`passage`, 19 Sep 2026)

A new mode, checked against this section before it shipped.

**What it sends.** Photographed pages of a story or article from a book, and any
text the teacher typed. It is asked to transcribe, not to answer anything. No
student work, no roster, no names, no answer key. Nothing a student wrote is in
this request: the pages come from a published text, not from a child.

**Why it exists, and what it changes downstream.** The transcribed text is kept
on the assessment (`Assessment.passage`) and travels with every student's
grading from then on (`passageForGrading()` in `lib/prompt-payload.ts`). That is
new content in the grading request, so it is named here: it is the story, not
the student. A comprehension answer cannot be marked honestly without the text
it is about, and the alternative -- attaching the photographed pages to each
student -- would pay to read the same story once per child and send a stack of
images 150 times over instead of once.

**Effect on identity.** None. The passage adds no identifier to any request, and
the grading request carries the same student-free payload it did before. The
`class_scan` prompt now sends `questionsForGrading()` rather than whole question
objects, which is strictly less than it sent before.

**The limit worth stating.** If a teacher photographs a page that happens to
carry a student's handwriting or name, that goes in like any other uploaded
image. This is the same honest limit already recorded above, not a new one.

## 5. Results back to the teacher

Returned scores, standards, and misconceptions are written to Postgres against the
internal student record, which is where the teacher's chosen label is reattached. The
teacher reviews and confirms before anything counts as final.

## 6. The deletion jobs

| Item | Detail |
|---|---|
| What | `purge-expired-uploads` Supabase edge function |
| Schedule | Daily at 09:00 UTC, via `pg_cron` calling the function over `pg_net` |
| Scope | `teacher_uploads` and the legacy `uploads` table |
| Method | Supabase Storage API, so the stored file is removed, not just its database row |
| Failure behaviour | A row is only marked purged after its file is confirmed deleted, so a failed run retries on the next night rather than reporting work as gone while it is still there |

| Item | Detail |
|---|---|
| What | `public.purge_scan_payloads()` |
| Schedule | Daily at 09:45 UTC, via `pg_cron` |
| Scope | `scans.params`, `scans.result` and `scans.error`, on rows older than 48 hours, every stage except `catalog` |
| Method | Plain SQL `UPDATE ... SET NULL`; no storage involved |
| Failure behaviour | Nothing to mark and nothing to half-do -- a failed run clears the same rows on the next night |

**Why an edge function rather than SQL.** Postgres blocks direct `DELETE` against
`storage.objects`. The documented escape hatch removes the metadata row but leaves the
file orphaned in the bucket, which would satisfy the audit trail while failing the
actual promise. The edge function goes through the Storage API instead.

---

## Payment

Billing is handled by the payment processor named in the Privacy Policy. Card details
do not reach our systems; we store a customer reference, plan, and status. No student
data is involved in this path.

---

## Things to re-check when the system changes

- Adding a new vendor that touches student data means updating the subprocessor table
  in the Data Processing Addendum and giving districts notice.
- Changing the retention window means updating four published pages: Privacy Policy,
  Student Data Privacy Commitments, How We Use AI, and the Data Processing Addendum.
  They currently all say deleted on confirming that student's grading, and 30 days at
  the outside. Both halves of that sentence have to stay true: the second is the
  backstop for work whose grading is never confirmed.
- Changing the AI provider or model means re-checking the training and retention terms
  before the change ships, not after.
- **Adding or changing an AI mode means re-reading section 4 before it ships.** A new
  mode decides for itself what goes in the prompt. `class_scan` added a roster to the
  payload and silently falsified four pages for a day. If a prompt gains a new field,
  ask what identity it carries.
- Any change to what reaches the provider means updating the same four published pages
  listed above, and the "last verified" date at the top of this file.
- **A deploy permalink carries the production service key and never expires on its own.**
  Keep Netlify's deploy retention limited, delete deploys that no longer need to exist,
  and keep `CANONICAL_HOST` set so the host guard makes new permalinks inert. The guard
  protects builds from itself onward only; old permalinks are contained solely by
  deleting them.
- **Adding a column that holds what a teacher or a student produced means deciding
  when it is cleared, in the same change.** `scans.result` was added so a background
  job could be collected and then kept a child's answers indefinitely, because nothing
  in the change that added it was responsible for the other end of its life.
