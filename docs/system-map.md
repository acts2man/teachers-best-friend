# System map

**Read this before changing anything. Update it in the same PR when behaviour changes.**

Last verified against the code: **2026-10-14, `main` at `831aa25`** (#134 merged); §1.10's prompt version re-checked 2026-10-15. Every
claim cites `file:line` as of that commit. Line numbers drift; the function names do not, so
search by name when a line has moved. Anything not checked against the running system says
so. `lib/teacher-server.ts` line numbers, §1.8 step 6, R7 and G4 re-checked 2026-10-14 for the
G4 fix (atomic revision check). R4 and G14 re-checked 2026-10-14 on `main` at `6ab8606` for the
G14 fix (#143). R6 and G18 re-checked 2026-10-14 on `main` at `ed58f7a` for the G18 fix;
§1.8 step 6, R7 and G4 re-checked on `ed58f7a` for the G4 fallback removal.
Migrations listed here are the repo's copies; production is applied **by hand**
(`supabase/migrations/README.md`), so "in the repo" is not proof it is live.

Contents:

1. [The class scan, hop by hop](#1-the-class-scan-hop-by-hop)
2. [Rules that must never break](#2-rules-that-must-never-break)
3. [Known risky areas](#3-known-risky-areas)
4. [Open gaps: traps the code has today that no incident has hit yet](#4-open-gaps)

The automated guards for section 2 live in `tests/invariants/` and run in `npm test`
(`package.json:14`) and on every pull request (`.github/workflows/tests.yml`).

---

## 1. The class scan, hop by hop

### 1.1 Capture (browser)

| Step | Code |
|---|---|
| Four ways in: in-app camera, Import from Photos, file pickers, desktop whole-stack upload | `components/teacher-class-scan.tsx:1272` (camera), `:1288` (photos), `:497` (`addPages`), `:971` (`startStackScan`) |
| Camera shot → JPEG → **IndexedDB** `tbf-scan-camera/shots`, keyed by assessment, pile and sequence number | `components/scan-camera.tsx:373-396`, `lib/scan-store.ts:22-23`, `:62` |
| "Next student" starts a new pile. **The piles are the teacher's own student boundaries.** Since 26 Oct 2026 it also **hands that student's pages to the panel, which uploads them in the background** while the teacher scans on (`onStudent` → `queueCameraStudent`, one student after another, each into its own pile; a page that still fails waits with Retry). The handed-over shots are marked `sent` (no longer deletable in the camera), and the mark is saved in IndexedDB so a reopened camera never offers them again (`restorableShots`). Each page leaves IndexedDB only once it has landed in its pile; a page the panel refused (setup checks, page limit) is un-marked and comes back from Finished, and a page that failed after its retries is un-marked in IndexedDB only (it waits with Retry; a reload still offers it). Until Next student a photo can be deleted. | `nextStudent` in `components/scan-camera.tsx`; `queueCameraStudent`/`landCameraStudent` in `components/teacher-class-scan.tsx`; `lib/camera.ts:222-230` |
| Done ("Finished"): the shots **not yet handed over** are partitioned by pile, **IndexedDB is cleared, then they are queued for upload**. The panel stays busy (Grade waits) until the queue is empty, and the account-copy sync does not apply the other device's copy while the camera is open or a student is uploading. | `done` in `components/scan-camera.tsx`; `busyScanning` and `paused` in `components/teacher-class-scan.tsx` |
| Photo import: EXIF order; default split is **2 pages per student** until the teacher fixes it | `lib/photo-import.ts:14`, `:169-188`; `components/photo-import.tsx:55`, `:90-91` |
| Page prep: upright, long edge ≤ 2000px, plus a separate **name-area copy (top 45%)** | `lib/image-prep.ts:128-140`, `:155-181`, `NAME_AREA` `:35` |

### 1.2 Upload and storage

- Each page is **two uploads**: the whole page (body) and the name strip. See `preparePage`
  (`components/teacher-class-scan.tsx:458-476`, uploads at `:470` and `:474`).
- `uploadFile` (`lib/upload-client.ts:35-52`) POSTs to `/api/uploads`
  (`app/api/uploads/route.ts:32-87`). The route checks the size (8 MB), the MIME type and the
  magic bytes, then calls `saveDocument`.
- `saveDocument` (`lib/teacher-server.ts:548-614`):
  - stores the file in bucket **`teacher-documents`** at `<ownerId>/<id>`;
  - inserts a **`teacher_uploads`** row with `page_count` and `content_sha256`.
- An insert trigger refuses a row with no hash
  (`supabase/migrations/20260923170000_a_scan_cannot_exist_uncharged.sql:158-178`).
- Recovery after a lost reply: `findUploadByHash` (`lib/teacher-server.ts:680-703`). It skips
  purged rows (26 Oct 2026; was gap G9).
- **Retries** (20 Oct 2026: a 72-page class scan stopped twice on one storage 520):
  - `uploadFile` tries 3 times, waiting 0.6 s then 1.8 s, on a 5xx, a dropped connection or an
    unreadable reply only. A 4xx is never retried. Before each retry it looks the file up by
    hash (`GET /api/uploads?sha256=`), so a retry never makes a second row or a second charge.
  - `saveDocument` retries the storage write itself (`lib/storage-retry.ts`, 3 tries) on a 5xx
    or no answer. A retry's "already exists" is success: the path is this upload's own.
  - **One live row per teacher per content hash** (`20261026120000`, **in the repo, not yet
    applied to production**): a unique index over rows not purged and not superseded, and a
    BEFORE INSERT trigger that reuses the existing row (renewing its retention) instead of
    adding a second; `saveDocument` answers with the id kept. The 2 duplicate pairs already in
    production are marked `superseded_by`, not deleted. Deleting a test, clearing or removing
    a class keeps any upload another test still uses (`uploadsNoLongerUsed`). So do the passage read (test page and setup, the setup counting its unsaved pages), releasing reviewed photos, and the roster read, and the setup screen's remove-file X: since one row serves every identical file, no delete of raw ids is left. The server enforces it too: `DELETE /api/uploads/<id>` answers 409 while the saved workspace (an assessment's pages, answer key, students' work or an answer's crop; a resource) or a class scan in progress still names the file (`uploadStillReferenced`), and `deleteUploads` treats that 409 as rightly kept.
  - On the class scan a page that still fails no longer ends the batch: it waits in
    `failedPages` with Retry / Leave it out (`placeRetriedPage`, `lib/scan-session.ts`), and
    grading waits until none is left.

### 1.3 Charging

- The stack is reserved up front with `reserveStack` (`components/teacher-class-scan.tsx:629`,
  `:880-893`), which calls `/api/scans/reserve`, which calls `chargePages`
  (`lib/page-ledger.ts:105-129`).
- A page is charged **once per byte-identical content**: `unique (teacher_id, content_sha256)`
  (`supabase/migrations/20260921200253_page_ledger_schema.sql:55-68`).
- `name_strip`, `catalog` and `key_check` are free (`lib/page-ledger.ts:31`).
- A failed run releases only the pages it never graded: `ungradedReservations`
  (`lib/teacher-class-scan.ts:1251-1268`), applied at `components/teacher-class-scan.tsx:830`.

### 1.4 Name pass (`name_strip`, AI)

- **Planning.** `planNameBatches` (`lib/teacher-class-scan.ts:69-85`) sends **one request per
  declared pile**, or **one per page** when there are no piles (#125). Calls are made at
  `components/teacher-class-scan.tsx:644-647`.
- **Running.** Four requests at a time (`NAME_CONCURRENCY`, `:90`; `mapLimit`, `:142-168`).
  Each is retried with backoff (`withRetry`, `:93-139`) when `isRetryableAnalyzeError`
  (`lib/analyze-client.ts:37-46`) allows it.
- **Server side.**
  - The prompt is at `lib/analyze-shared.ts:574-579`.
  - Validation is at `:910-956`: out-of-range pages are dropped, the first duplicate wins, and
    a page the model left out is marked `skipped`.
- **Mapping answers back to pages** happens in `mergeNameReads` (`lib/teacher-class-scan.ts:178-208`):
  - it is **by position within the request** (`slice[r.page]`, `:191`);
  - a failed or skipped read stays `failed` (unknown), which is different from "no name".
- The provider is the OpenAI Responses API (`lib/analyze-server.ts:29`). The roster is
  **never** sent: the name is matched to a student on our side (rule R12).

### 1.5 Grouping pages into students

- **Declared piles (preferred).** `groupPagesByCapture` (`lib/teacher-class-scan.ts:365-375`).
  A boundary the teacher drew is a fact.
- **No piles.** `groupPagesByName` (`:236-277`):
  - a named page starts a student;
  - **a page with no name continues the student before it** (gap G2);
  - a failed read starts its own group;
  - a name shared by two rostered students always starts a new group;
  - a name that `repeatedOffRoster` (`:303-320`) flags as a motto or an unrostered student
    gets a group of its own.
- Chosen at `components/teacher-class-scan.tsx:692-694`.

### 1.6 Grading (`class_scan`, AI)

- **Batching.** `planScanBatches` (`lib/teacher-class-scan.ts:1168-1213`) never splits a
  student across requests. Each batch renumbers groups from 0 and records `groupIndexes` back
  to whole-scan group numbers.
- **Server side** (`lib/analyze-shared.ts:849-909`):
  - group numbers that are invented or repeated are dropped (`:879-886`);
  - question ids not in the assessment are dropped (`:891`);
  - an answer region that points at another group's page is dropped (`:896`);
  - the verdict passes through raw.
- **Client side.**
  - `gradeInBatches` (`lib/teacher-class-scan.ts:1429+`) maps results back with
    `absorbGraded` (`:1305-1317`, using `groupIndexes[g.group]`).
  - It re-asks short groups, and re-asks multi-part answers that came back with too few
    parts (`partsShortfall` `:1341`, `settleShortParts` `:1417`, which sends the leftovers to
    Unsure).
- **Three at a time** (`GRADE_CONCURRENCY`, 26 Oct 2026). `gradeInBatches` keeps at most three
  batches in flight, started in order. Each batch's answers go in their own slot, so what is
  banked and returned is in batch order however the requests finish. A failed batch starts
  nothing new; the batches already running finish and are banked, then the error is thrown.
  `concurrency` defaults to 1 (one after another) for every other caller.
- **Grading beside the name pass.** When the groups are known before any name is read
  (declared piles with no whole-stack pile, or a resume's saved grouping), `gradePages` starts
  grading at once and reads the names alongside. A whole-stack upload is split *by* the
  names, so it still waits for them. If every name read fails while grading from declared
  piles, the grades are kept and every pile is left for the teacher to pick the student.
- **Grading speed.** The browser console logs each run's total time. The same numbers are in
  `scans` (one row per request, `created_at`/`completed_at`, `stage` `name_strip` or
  `class_scan`): a read-only query grouping a teacher's rows within ten minutes of each other
  gives each run's wall time. The 21 Oct 2026 class set (36 piles, 10 grading requests) took
  447 s one after another. Replayed with its recorded durations
  (`tests/grading-concurrency.test.mjs`), the old order takes 454 s and the new one 141 s,
  with identical names and grades.
- **Banked progress.** Progress is saved after each batch as `{graded, nextBatch, scanId,
  layout, inFlight}` (`record()` in `gradePages`, `components/teacher-class-scan.tsx`), keyed by
  **whole-scan group index**. With batches three at a time, `scanId`/`inFlight` are the job
  of the **first batch not yet back**: that is the only one a resume, which plans the ungraded
  students from the top, can wait on. The others are sent again (free: pages are charged once). `layout` is the body upload ids of every group those indexes
  refer to (`groupLayout`, `lib/scan-session.ts`).
- **Resume.** `gradeCaptured` asks `planResume(progress, pageIds)` (`lib/scan-session.ts`):
  - `resume` only when the pages on screen are exactly the layout's pages in the same
    order; the run then uses the **saved** grouping, never one re-derived from the piles,
    plans only the students not yet graded (`planRemainingBatches`, whole-scan numbering),
    and waits on an in-flight job only if it was sent for exactly those students
    (`inFlightMatches`);
  - `changed` (pages added, removed, reordered, merged in, or progress saved before layouts
    existed) stops and asks the teacher to grade again (`askToRegrade`). Nothing is
    guessed; already-paid pages cost nothing the second time.
  - A whole-stack upload marks its pages `stack: true`; its pile is split by names, never
    graded as one declared student, and declared piles beside it stay one student each
    (`groupMixedPiles`, `namePilesFor`; G3, G17).

### 1.7 Matching screen (teacher review)

- `resolveScannedGroups` (`lib/teacher-class-scan.ts:751-883`) joins the names, the groups and
  the grading by group index (`gradedByGroup.get(i)`, `:760`, `:835`). It matches names to the
  roster with `matchRosterStudent` (`:689-751`).
- **Pre-fill.** A student is chosen for the teacher **only** when there is exactly one match
  with fit ≥ 0.9, the name was read at ≥ 70%, **and** the written given name is the roster's
  or a known short form of it (`givenNameMayPrefill`, G12; `PREFILL_SCORE`, `PREFILL_READ`
  and `strongMatch` in `resolveScannedGroups`). Anything weaker becomes a suggestion or a list of candidates
  for the teacher to pick from.
- Repeated off-roster names are marked `unassigned: "repeated"` (`:870-881`).
- Teacher edits: `updateGroup`, `toggleDiscard`, `chooseStudent`, and the split "These are 2
  different students" (`components/teacher-class-scan.tsx:1006`, `:1010`, `:1185`, `:1092`).
- **Save is blocked** while any row still has candidates or is unassigned (`:1029`, button at
  `:1645`).

### 1.8 Confirm and save

`saveAll` (`components/teacher-class-scan.tsx:1019-1081`):

1. Rows kept: `!discarded && g.name.trim()` (`:1021`). An empty name is dropped silently;
   see gap G6.
2. If any scanned student already has grades the teacher confirmed, `saveAll` first asks
   (`confirmedGradesAtRisk`, `ConfirmRescan`): keep them / replace them / cancel (G5).
   Then `applyScannedGroups(a, students, classroom.id, rows, { replaceConfirmed })`
   (`lib/teacher-class-scan.ts`, `applyScannedGroups`):
   - creates a student for each row with no `studentId`, or whose student has been removed
     since;
   - maps verdicts through `normalizeRecognizedResponses` (`lib/teacher-workflow.ts`);
   - the first row for a student is merged with **previously saved** responses through
     `mergeStudentResponses`, which keeps confirmed grades unless `replaceConfirmed`; two rows
     of one scan are merged with `mergeSplitGroups`, which keeps them too;
   - `studentOrder` is appended (`:1074-1075`).
3. The payload is the **whole workspace**:
   `{...w, students: reconcileEvidence(keepOtherClassStudents(w.students, students, result.students), result.assessment), assessments: w.assessments.map(...)}`
   (`components/teacher-class-scan.tsx:1051-1061`). Rule R1.
4. `save()` (`components/teacher-app.tsx:313-362`) PUTs `{workspace, revision}`:
   - a save already in flight makes the next one **return `false` with no message**
     (`lock`, `:330`), gap G7;
   - any error, including 409, is shown as a toast. There is no retry and no merge.
5. `PUT /api/workspace` (`app/api/workspace/route.ts:117-180`):
   - drops `sharedStandards` (`:133-134`);
   - validates against a schema that is **loose for assessments** (`z.any()` questions and
     responses, `:66-77`);
   - clamps titles to 200 characters (`:165-166`);
   - calls `updateWorkspace(id, workspace, revision)` and returns **409 when it returns null**
     (`:170-175`).
6. `updateWorkspace` (`lib/teacher-server.ts:472-482`). On Supabase it makes **one** call,
   `sync_workspace_if_revision(p_teacher, p_data, p_expected_revision)` (`:481`, helper
   `syncWorkspaceIfRevision` at `:342-354`;
   `supabase/migrations/20261014120000_atomic_workspace_revision.sql`). In one transaction
   that function:
   - locks the `teacher_workspaces` row (`select ... for update`), so a second save for the
     same teacher waits;
   - returns null when there is no row or the revision differs, which the route turns into the
     409. It does not raise, so a stale save is never a 500;
   - otherwise calls `sync_workspace(p_teacher, p_data)` and returns the new revision.
   - Any error from it, the function missing (PGRST202) included, is a 500. There is no
     non-atomic fallback: it was removed on 14 Oct 2026 once the migration was applied and
     every production save that day (4 of 4) went through the function.
   - The reset (`replaceWorkspace`, `:493-525`) goes through the same function, carrying the
     revision it has just read, and reads again once if a save lands in between. If it loses
     twice it throws a 409 ("Your classroom changed while it was being reset. Try again.");
     it never falls back to an unlocked sync. It calls `sync_workspace` directly only when
     there is no row yet. Reason: a direct `sync_workspace` writes the child tables first and
     the workspace row last, the opposite lock order, so the two together can deadlock.
7. `sync_workspace(p_teacher, p_data)` is the current body as rebuilt by
   `tests/invariants/lib/workspace-sql.mjs`: the whole definition in
   `supabase/migrations/20261008190000_points_final_answers_stable_order.sql:37-317`, plus the
   patches in `20261012200000` (answerParts), `20261013120000` (gradedAlone),
   `20261013130000` (secondChoice), `20261014130000` (custom standards keyed per framework,
   their extras saved in `meta`; **in the repo, not yet applied to production**) and
   `20261020120000` (assessment `gradingMode`, only `'sbg'` stored; **in the repo, not yet
   applied to production**). For each table it **upserts the rows it is sent and deletes
   every row it is not sent**:

   | Table | Delete statement |
   |---|---|
   | classes | `20261008190000…:59` |
   | students | `:77` |
   | student_evidence | `:98` |
   | assessments | `:133` |
   | assessment_questions | `:165-171` |
   | student_responses | `:202` |
   | student_writing_scores | `:232` |
   | lessons | `:244` |
   | resources | `:253` |
   | student_groups and student_group_members | `:265-268` |
   | standards (custom) | `:288`, replaced by `20261014130000`: deletes a row only when no payload row has its framework, grade, subject **and** code |

   - Responses are inserted through **inner joins** on the question and the student
     (`:188-189`). A response whose question or student is missing from the payload is
     silently not saved.
   - Responses upsert `on conflict (question_id, student_id)` (`:191`). **Two payload rows
     hitting the same key fail the entire save** (rule R14). Custom standards upserted
     `on conflict (teacher_id, code)` (`:283`), which failed every save of a teacher with one
     code in two frameworks (gap G8); `20261014130000` upserts them on
     `(teacher_id, framework, grade, subject, code)` from a `distinct on` over the same four
     fields, so a repeated row keeps the last copy instead of failing.
   - The function then bumps `teacher_workspaces.revision` (`:301-306`).

### 1.9 Reload

- `GET /api/workspace` (`app/api/workspace/route.ts:90-115`) calls `readWorkspace`
  (`lib/teacher-server.ts:446-465`). It reads the **revision first, then the data**, so a save
  in between shows up as a 409 on the next PUT.
- `get_workspace_json` (`20261008190000…:320-468` plus the four patches) builds the JSON from
  a **fixed list of columns**. `jsonb_strip_nulls` removes null keys.
- `normalizeWorkspace` (`lib/teacher-server.ts:411-444`) and `withAssessmentDefaults`
  (`lib/workspace-safety.ts:24-32`) put back the defaults a stripped key loses.
- The client copy is refreshed when it is older than 2 minutes or the tab becomes visible
  again (`components/teacher-app.tsx:94`, `:198-245`).

### 1.10 The reuse cache

- Only for `assignment`, `passage`, `roster` and `answer_key` reads (`lib/analyze-server.ts:236-241`).
  **Never for grading or names**, so it cannot move a grade onto a student.
- **Key.** `reuseFingerprintKey` (`lib/analyze-server.ts:299-322`) uses: the prompt version
  (`READ_PROMPT_VERSION`, `lib/analyze-shared.ts`; 6 since 15 Oct 2026, when the read was told
  to write standard codes without their titles -- bumping it is what forces a fresh read);
  the mode, subject, grade and framework; the target standards; the **length** of the passage;
  the model settings; and the **sorted, de-duplicated** page hashes.
- **Lookup.** `reusablePriorResult` (`:342-385`) requires the same teacher, a complete and
  billable scan, and an exact key match. It is skipped on `freshRead`.
- Column and index: `supabase/migrations/20260930260000_scan_reuse_fingerprint.sql:83-91`.
- Two limits in practice:
  - The synchronous path never writes `scans.result` (`app/api/analyze/route.ts:372-400`), so
    only async scans are ever reused.
  - Results are purged after 48 hours.
- See gap G10.

### 1.11 `class_scan_sessions` and the local draft

These are the server copy and the local copy of a scan **in progress**, so a phone and a
computer can share one scan. They are separate from the workspace.

- **Table.** One row per (teacher, assessment), holding `state jsonb` and `revision`, expiring
  after 7 days (`supabase/migrations/20261008170000_class_scan_sessions.sql:29-40`). It is
  purged daily at 09:30 UTC (`:59-68`).
- **What it holds** (`lib/scan-session.ts:36-54`): piles, progress (**transcribed answers**),
  groups (**names read**), discarded rows, upload ids, and the grading lock.
- **API.** `app/api/scans/session/route.ts`:
  - PUT is revision-checked (`:214-235`), **except the first write**, which is an
    unconditional upsert (`:193-212`).
- **Client.** `components/use-scan-session.ts`:
  - debounced 800 ms (`:12`) and polled (`:196-218`);
  - on 409 it merges and retries once (`:116-125`), **even mid-grade** (gap G1); the merge
    keeps the progress with more students graded (`mergeSessions`);
  - merging is in `mergeSessions` (`lib/scan-session.ts:203-240`).
- **Local draft.** `localStorage['tbf.scan-draft.<assessmentId>']` holds piles and progress
  (`components/teacher-class-scan.tsx:83`, `:410-421`). Its 7-day lifetime is checked only
  when it is read.
- **Cleared on save or Start over**: `reset()` → `sync.clear()` (`:586-600`).

### 1.12 Retention and purge

| What | Kept | Mechanism |
|---|---|---|
| Uploaded files (`teacher-documents`) and `teacher_uploads` rows | 30 days (rows stay, marked `purged_at`) | `20260915005258_teacher_uploads_30_day_retention.sql:10-21`; edge function `supabase/functions/purge-expired-uploads/index.ts`, **200 rows per table per run** (`:18`). Its cron schedule lives only in `cron.job` (`supabase/migrations/README.md:59-79`). The job recorded in `20260909175336_tbf_11_scheduled_purges.sql:2-7` calls a function since **dropped** (`20260915005628…:6-7`). **Not checked on production: run `select * from cron.job`.** |
| `scans.params/result/error` (AI payloads) | 48 hours | `purge_scan_payloads`, `20260921233844_clear_scan_payloads_after_48_hours.sql:99-137` (09:45 UTC) |
| `class_scan_sessions` | 7 days | 09:30 UTC job (above) |
| `app_events` | 30 days | `20261012190000_app_events_and_regression_replay.sql:91-95` (09:50 UTC) |
| Camera shots in IndexedDB | **No expiry** | `lib/scan-store.ts`; cleared on Done or Discard (`components/scan-camera.tsx:671`, `:688`, `:701`) |
| Local scan draft | 7 days, checked only on read | `components/teacher-class-scan.tsx:99`, `:121` |
| Files left with no row (12 Oct restore) | Until an admin runs the script | `scripts/admin/orphan-photos.mjs` (report, then a reviewed delete) |
| Account deletion | Immediate | `lib/account-deletion.ts` (cancel billing first), `lib/account-deletion-server.ts:46-138`, `20260921235057_delete_teacher_account…sql` |

### 1.13 Where state lives

| State | Browser only | Server |
|---|---|---|
| Workspace (classes, students, assessments, responses…) | React state plus the module `workspaceSnapshot` (`components/teacher-app.tsx:89`, `:141`) | Relational tables via `sync_workspace`; `teacher_workspaces` keeps only settings, `activeClassId` and `revision` (`20261008190000…:301-306`) |
| Workspace revision | React state (`components/teacher-app.tsx:144`) | `teacher_workspaces.revision` |
| Camera shots not yet handed off | IndexedDB | — |
| Pages uploaded | — | Storage plus `teacher_uploads` |
| Scan in progress (piles, progress, names, matches) | localStorage draft | `class_scan_sessions` (7 days) |
| Matching-screen rows before Save | React state, mirrored to `class_scan_sessions` | Nothing in the workspace until Save |
| Split helper data (`shownRun`) | **React state only**: lost on reload, so the split button disappears (`components/teacher-class-scan.tsx:399`, `:1161`) | — |
| AI request/response payloads | — | `scans.params/result` (48 hours) |
| "Grade on their own" | — | `student_responses.graded_alone` (since `20261013120000`) |

---

## 2. Rules that must never break

Each rule lists: **why** (the incident that taught it), **enforced by** (the code that keeps
it true), and **guarded by** (the test that fails if it breaks). "NO TEST YET" means a gap
this file owns until a test exists.

**R1. A save always sends every class's students, assessments and responses.** `sync_workspace`
deletes anything the payload leaves out.
- **Why:** 12 Oct 2026, fixed in #123. A teacher with five classes saved a class scan; the
  panel sent only the active class's students, and the other four classes lost every student
  and every graded response.
- **Enforced by:**
  - the delete statements listed in §1.8;
  - `keepOtherClassStudents` (`lib/teacher-class-scan.ts:927`);
  - the panel payload (`components/teacher-class-scan.tsx:1051-1061`);
  - the context's `students` is one class only (`components/teacher-app.tsx:395`), which is
    what makes the mistake easy.
- **Guarded by:**
  - `tests/invariants/class-scan-save-keeps-other-classes.test.mjs`: a fuzz over multi-class
    workspaces through a model of the deletes; every `save({...w, students: …})` in
    `components/` is checked for the one-class list;
  - `tests/class-scan-keeps-other-classes.test.mjs`;
  - `tests/invariants/workspace-field-round-trip.test.mjs`, which pins the list of tables
    `sync_workspace` deletes from.

**R2. Every field of a workspace type is named in BOTH `sync_workspace` and `get_workspace_json`.**
- **Why:** `response.errorType` (#84, 30 Sep 2026) and `assessment.pointsPossible` both
  vanished on reload; fixed by `20260930220000_persist_dropped_workspace_fields.sql`. See
  CLAUDE.md "Workspace persistence".
- **Enforced by:** migrations. Use the patch style of `20261013130000_question_second_choice.sql`
  for any new field.
- **Guarded by:**
  - `tests/invariants/workspace-field-round-trip.test.mjs`: it **rebuilds both functions from
    the migrations** (including the patch migrations, applying the same exactly-once rule they
    enforce) and checks every field of Classroom, Student, Evidence, Assessment, Question,
    StudentResponse, Group and Standard;
  - `tests/workspace-persistence-guard.test.mjs`: the hand-kept list.
- **Known exception:** none. `Standard`'s skills, prerequisites, next, vocabulary,
  misconception, example, dok, source and officialCode were not saved (gap G11); since
  `20261014130000` they ride the row's `meta` column and the allow-list in the test is empty.
  **That migration is in the repo, not yet applied to production**: until it is, the loss is
  still live.

**R3. One student's pages and answers never land under another student.** Leaving a page
unassigned is always allowed.
- **Why:**
  - 10 Oct 2026 (#121): the motto "Hope Always" took over two students' names.
  - 12 Oct 2026 (#125): twelve name strips per request, with names one position late, put a
    classmate's name on another child's paper.
  - 13 Oct 2026 (#125 review): a motto-shaped name that was really an unrostered student had
    their pages folded under three other children.
  - 9 Oct 2026 (#115, Ricky): never pre-fill a roster name on a weak match.
- **Enforced by:**
  - `planNameBatches` (`lib/teacher-class-scan.ts:69`);
  - `mergeNameReads` failed-stays-unknown (`:178`);
  - `groupPagesByName` (`:236`) and `repeatedOffRoster` (`:303`);
  - `matchRosterStudent` and its pre-fill thresholds (`:636-648`, `:689`);
  - `resolveScannedGroups` (`:751`);
  - the save refuses unresolved rows (`components/teacher-class-scan.tsx:1029`);
  - `applyScannedGroups` treats a removed student as unmatched (`:1013`).
- **Guarded by:**
  - `tests/invariants/no-wrong-student.test.mjs`: a fuzz of shuffled, duplicated, missing
    (failed), motto and accented names through an adversarial name pass that rotates or
    reverses names inside each request, for both declared piles and name-split stacks;
  - `tests/name-grouping-cases.test.mjs`, `tests/name-pass-per-student.test.mjs`,
    `tests/same-name-split.test.mjs`, `tests/teacher-class-scan.test.mjs`.
- **Open:** gap G2 is a way this rule breaks today. G1 (#144), G3 (#140) and
  G12 (#141) are fixed in code; the resume is guarded by
  `tests/invariants/scan-resume-layout.test.mjs` (`planResume`, `planRemainingBatches`,
  `inFlightMatches` in `lib/scan-session.ts` / `lib/teacher-class-scan.ts`) and near
  names by `tests/invariants/no-near-name-prefill.test.mjs`.

**R4. Never mark an answer correct when it is wrong; never mark it blank when the student wrote something; uncertain goes to Unsure.**
- **Why:**
  - 8 Oct 2026 (d2a02c5, Michael's class): questions the model skipped were scored blank for
    students who had written work.
  - 12 Oct 2026 (#125, Ricky): sign-flipped answers, mostly in LaTeX, were matched to the key.
- **Enforced by:**
  - Credit comes **only** from the model's `match`, mapped in `normalizeRecognizedResponses`
    (`lib/teacher-workflow.ts:496-556`).
  - A match is taken away when `provablyDifferent` says so (`lib/math-answer.ts:464`, used at
    `teacher-workflow.ts:508-509`). The direction is fixed: a match **stands unless the answer
    provably differs**. Requiring proof of equality instead was measured on 14 Oct against
    teacher-confirmed right answers and would have sent 130 of 216 in one class to Unsure.
    A key's label, a unit or noun the student left off, a thousands comma or prose around the
    answer is never a difference; a different value behind a unit/%/°/$, a different unit, a
    different number of values (± counts as two) or "x is 5" vs "x is 6" is.
  - A question that is missing, reported twice, or short of parts becomes Unsure
    (`teacher-workflow.ts:518-520`).
  - The verdict rules are in `lib/analyze-shared.ts:187-188`.
  - The Unsure group is `groupAnswers` at `teacher-workflow.ts:1066`.
  - The green bar only confirms clean matches (`autoGradedToConfirm`, `:1224-1237`).
- **Guarded by:**
  - `tests/invariants/never-correct-when-wrong.test.mjs`: a fuzz over integers, decimals,
    fractions, LaTeX `\frac`/`\dfrac`/mixed numbers, Unicode minus and `x =` prefixes, plus a
    check that skipped answers go to Unsure;
  - `tests/sign-flip-latex.test.mjs`, `tests/grading-verdicts.test.mjs`,
    `tests/confirm-matches-confidence.test.mjs`;
  - `tests/invariants/sign-guard-units-parts.test.mjs` (G14): the hidden differences are
    caught, and 50 right-but-differently-worded answers keep their match.
- **NO TEST YET:**
  - "never blank when written": a model `blank` verdict on an answer that has text still wipes
    the text (gap G13).

**R5. Grading one student or group never changes another's grade.**
- **Why:** 12 Oct 2026 (#126 round 3, Ricky's question 8). "Grade on their own" lived only in
  the browser. A pulled-out student merged back into their old group, "Change" re-graded them,
  and the green bar confirmed them.
- **Enforced by:**
  - `applyGroupScore` touches exactly the ids it is given (`lib/teacher-workflow.ts:1169`);
  - a `gradedAlone` response is always a group of one (`:1040-1057`) and is never on the green
    bar (`:1230`);
  - the flag is persisted (`20261013120000_response_graded_alone.sql`).
- **Guarded by:** `tests/invariants/grading-isolation.test.mjs` (a fuzz of every Grade-by-question
  action) and `tests/graded-alone.test.mjs`.
- **Note:** a student graded one by one from the Unsure group is **not** marked `gradedAlone`.
  Once they share an answer and a credit with a group, they join it, and "Change" on that
  group moves them too. That is by design; it is the reason "Grade on their own" exists.

**R6. Re-reading a test never silently clears existing grades.**
- **Why:** #134 (13 Oct 2026). Re-reading the questions wiped every student's responses with
  no warning.
- **Enforced by:**
  - `gradesClearedByReread` and `rereadWarning` (`lib/teacher-workflow.ts:1465`, `:1482`);
  - `components/confirm-reread.tsx`, wired in `components/teacher-scan.tsx:116` and in
    `components/teacher-assessments.tsx` (dialog near `:709`).
- **Guarded by:** `tests/reread-confirm.test.mjs`, which also scans the source: every
  re-read button must go through the confirmation.
- **Re-scanning** students' work (G5, fixed in code by the G5 PR): `mergeStudentResponses` and
  `applyScannedGroups` keep confirmed (verified) grades unless told `replaceConfirmed`; the class
  scan's `saveAll`, the one-student "Check student work" and the review screen's "Upload
  pages" ask first with the exact count
  (`confirmedGradesAtRisk`, `rescanWarning`, `ConfirmRescan` in `components/confirm-reread.tsx`):
  keep my confirmed grades / replace with the new scan / cancel. Guarded by
  `tests/invariants/rescan-keeps-confirmed.test.mjs`.
- **Re-scoring writing** (G18, fixed in code): "Replace writing" / "Add writing" in
  `components/teacher-assessments.tsx` (`WritingReview`) asks first when the student has
  confirmed trait scores -- keep my confirmed scores / replace with new scores / cancel, with
  the count (`writingReplaceWarning`, through `ConfirmRescan`) -- before anything is uploaded
  or scored. `replaceWritingResponses` keeps verified trait scores unless told
  `replaceConfirmed`. Guarded by `tests/invariants/writing-replace-keeps-confirmed.test.mjs`.

**R7. A stale browser tab never overwrites newer data.**
- **Why:** every save replaces the whole workspace (R1), so a tab that loaded before another
  tab's save would delete what that save added. No incident is recorded: the guard predates
  this repository's history (23 Sep 2026).
- **Enforced by:**
  - the revision check in `updateWorkspace` (`lib/teacher-server.ts:481`), made under a
    row lock inside `sync_workspace_if_revision`
    (`supabase/migrations/20261014120000_atomic_workspace_revision.sql`), and the 409 in the
    route (`app/api/workspace/route.ts:170-175`);
  - `readWorkspace` reads the revision before the data (`lib/teacher-server.ts:446-457`).
- **Guarded by:**
  - `tests/invariants/stale-revision.test.mjs`, which runs the real `updateWorkspace` against
    an in-memory database;
  - `tests/invariants/atomic-revision.test.mjs`: two (and five) saves carrying the same
    revision at the same moment, against a database that models the row lock, write exactly
    once; a missing function is a 500, never a fallback to the unlocked check (and the
    fallback is absent from the source); the reset takes the same locked path; and the migration locks the row and compares
    before it syncs. Proof on the database: `supabase/checks/atomic-revision-round-trip.sql`
    (two-session race script included; run it in psql).
- **Residual risk (deadlock):** `initializeWorkspace` (first load, no row yet, so it cannot
  collide with a locked save) and the SQL `reset_teacher_data()` still call `sync_workspace`
  directly, child tables first and the workspace row last. If one runs at the same moment as a
  locked save for the same teacher, Postgres aborts one with a deadlock error: a 500, nothing
  half-written. No test; see G4.

**R8. No student data in the public repo, CI logs, `app_events` or screenshots.**
- **Why:** CLAUDE.md and `docs/student-data-flow.md`. These are published commitments in
  `content/legal/`.
- **Enforced by:**
  - `scrubEventText` and `scrubDetail` (`lib/app-events.ts:126-195`), also re-applied on the
    server (`:364-381`);
  - `logAiFailure` stores counts and enums only (`lib/app-events-server.ts:42-67`);
  - placeholder names in tests, fixtures and browser-check scripts;
  - `.gitignore` excludes the orphan-photo manifests.
- **Guarded by:** `tests/app-events-scrub-names.test.mjs` and `tests/app-events.test.mjs`
  (`app_events` only).
- **NO TEST YET for the repo, CI and screenshots.** Known leaks:
  - `scrubDetail` accepts **any key name** with a numeric value, so `{MariaLopez: 1}` would be
    stored;
  - the provider's error body (up to 400 characters) goes to server logs and to `scans.error`
    (`lib/analyze-server.ts:49-62`);
  - the workspace-save rejection log prints zod messages (`app/api/workspace/route.ts:147-153`);
  - `.github/workflows/golden-set-eval.yml` uploads `golden-set-report.txt`, which prints
    uncaught errors raw.

**R9. A database change is patchable in place: `set lock_timeout`, no DROP.**
- **Why:** migrations are applied by hand to production (`supabase/migrations/README.md`).
  - A `CREATE OR REPLACE VIEW` silently dropped another session's `security_invoker` flag
    (README).
  - A whole-body redefinition written against an old copy reverts other people's changes. This
    is why `20261012200000` onward patch the live definition with `pg_get_functiondef` and
    refuse to run if a fragment is not found exactly once.
- **Enforced by:** convention since `20261012190000`.
- **Guarded by:**
  - `tests/invariants/migration-safety.test.mjs`: from `20261012190000`, every file must set
    `lock_timeout` and may not drop a table, column, function, view, type, schema or index; a
    dropped policy or trigger must be re-created in the same file. Exceptions are named one
    statement at a time in `ALLOWED_DROPS` in that test, and only an index may be listed;
  - **the one exception so far:** `20261014130000_custom_standards_per_framework.sql` drops the
    index `custom_standards_key` on `(teacher_id, code)` (gap G8). A unique index cannot be made
    non-unique except by dropping it, and it rejected the same code in two frameworks. An index
    holds no data; the file builds the wider unique index and re-points `sync_workspace` at it
    first, in the same transaction;
  - `tests/invariants/workspace-field-round-trip.test.mjs`: replays every patch migration and
    fails where one would raise on the database.

**R10. Viewing another teacher's account is read-only.**
- **Why:** if a view-as session lapsed, the next save would write the teacher's classroom into
  the manager's account, and `sync_workspace` would delete the manager's own data
  (`lib/teacher-server.ts:140-150`).
- **Enforced by:** `assertNotImpersonating` and `writingTeacherId` (`lib/teacher-server.ts:151-168`),
  which refuse while the view-as **cookie is present**; the client refusal is at
  `components/teacher-app.tsx:322`.
- **Guarded by:** `tests/admin-api-gate.test.mjs`, `tests/account-export.test.mjs` and
  `tests/account-deletion.test.mjs`.

**R11. A page is charged at most once, and no scan exists uncharged.**
- **Enforced by:** `unique (teacher_id, content_sha256)` and `create_scan` charging in the same
  transaction (`20260923170000_a_scan_cannot_exist_uncharged.sql:68-139`); `settleCharge` in
  `app/api/analyze/route.ts:223-227`.
- **Guarded by:** `tests/retry-charges-once.test.mjs` and `tests/page-metering.test.mjs`.

**R12. No AI request carries the roster or a typed student name.** The name is read from the
page, and matched to a student on our side.
- **Why:** CLAUDE.md: a mode once put a class roster in a prompt and contradicted four
  published pages for a day.
- **Enforced by:** `buildPrompt` (`lib/prompt-payload.ts`); matching happens only in
  `resolveScannedGroups` (`lib/teacher-class-scan.ts:751`).
- **Guarded by:** `tests/prompt-separation.test.mjs`. **Re-read `docs/student-data-flow.md`
  section 4 before any prompt change.**

**R13. A title, an odd number or a bad flag never fails a whole save.**
- **Why:** an over-long title once failed `assessments_title_check` and with it the whole save
  (#72).
- **Enforced by:**
  - titles clamped in the route (`app/api/workspace/route.ts:165-166`);
  - patched fields clamp or null bad values instead of raising
    (`20261012200000…:41`, `20261013120000`, `20261013130000`, `20261020120000`);
  - the `safe_int`, `safe_numeric`, `safe_bool` and `safe_date` casts.
  - `assessments.points_possible` is `numeric` and written with `safe_numeric`, only when it
    is above 0 and at most 1,000,000 (`20261020130000`, **in the repo, not yet applied to
    production**). It was `integer` via `safe_int`, which dropped a 2.5 total on save; the bound
    also keeps out `NaN`/`Infinity`, which jsonb cannot hold.
- **Guarded by:** `tests/assessment-title-and-empty-read.test.mjs`.
- **NO TEST YET:** `createdAt` is cast with a bare `::timestamptz`
  (`20261008190000…:119`), so a malformed `createdAt` fails the whole save.

**R14. One save never holds two rows for the same database key.** `ON CONFLICT DO UPDATE`
fails the whole save if one statement touches the same row twice.
- **Enforced by:** `normalizeRecognizedResponses` emits one response per question
  (`lib/teacher-workflow.ts:501`); `mergeSplitGroups` merges two rows for one student
  (`lib/teacher-class-scan.ts:973`). Custom standards: the database key is the key the app
  uses, `(teacher_id, framework, grade, subject, code)`, and `sync_workspace` reads them through
  a `distinct on` that key (`20261014130000`, **not yet applied to production**).
- **Guarded by:** `tests/invariants/no-wrong-student.test.mjs` (no student and question pair
  saved twice); `tests/invariants/custom-standards-key.test.mjs` (the upsert's target, the
  live unique indexes on `public.standards` after replaying every migration, the payload
  `distinct on`, the delete, and the catalog loader's de-duplication all use the same four
  fields). Proven on the database by `supabase/checks/custom-standards-round-trip.sql`.

---

## 3. Known risky areas

Where a small change has the widest effect, roughly in order.

1. **`sync_workspace` / `get_workspace_json`** (the migrations above). Each one is a single
   function for the whole classroom. A missing key is lost data (R2); a missing row is a
   deletion (R1); one bad value or duplicate fails every save for that teacher (R13, R14).
   Change it only with the patch-style migration, and prove it with a rolled-back round trip
   (`supabase/checks/*-round-trip.sql`).
2. **`components/teacher-app.tsx` `save()` and the context** (`:313-418`).
   - Every screen saves the whole workspace through this one function.
   - The context's `students` and `assessments` are **one class only** (`:395-398`); handing
     either to `save` deletes the other classes (R1).
   - The in-flight lock drops overlapping saves silently (G7).
3. **`lib/teacher-class-scan.ts`.**
   - Grouping, name matching and batching all join on **array positions and group numbers**:
     `slice[r.page]`, `groupIndexes[g.group]`, `gradedByGroup.get(i)`, `"group-" + i`.
   - An off-by-one, or anything that renumbers groups between the grading and the matching
     screen, moves answers between children with no error (R3; G1, G3).
4. **`lib/teacher-workflow.ts` `normalizeRecognizedResponses`, `groupAnswers`, `applyGroupScore`
   and `mergeStudentResponses`.** Every grade passes through these four. They decide credit
   (R4), isolation (R5) and what a re-scan keeps (G5).
5. **`lib/math-answer.ts`.**
   - It is the only thing standing between a model's mistaken "match" and full credit.
   - It folds case, strips spaces and cuts at words such as "is", "for" and "because"
     (`:90-105`), so it is lossy by design.
   - It must stay one-directional: it may take credit away, never grant it.
6. **`components/teacher-class-scan.tsx` resume and sync** (`gradeCaptured`, `gradePages`;
   `components/use-scan-session.ts`; `lib/scan-session.ts` `planResume`, `mergeSessions`).
   Progress is saved as whole-scan group indexes plus the `layout` they refer to. Anything
   that renumbers groups, or reuses progress without `planResume`, moves answers between
   children (G1, G3). A resume plans only the ungraded students; never skip by `nextBatch`.
7. **`app/api/workspace/route.ts` schema.** It is deliberately loose for assessments
   (`z.any()`). It will accept any field, and that field is then dropped by the database (R2).
8. **Migrations applied by hand.** Merging a PR does not apply its SQL. The app can ship ahead
   of the schema, and a field then round-trips in tests and vanishes on production. Confirm on
   production with the round-trip check before merging.

---

## 4. Open gaps

These are ways the code breaks the rules today. Each one is reproduced or confirmed by
reading the code, as marked. None has a test in the suite, because each test would fail on
`main`; a fix should land together with its test.

- **G1. Resuming after the piles changed re-mapped saved answers by index** (R3).
  - **Fixed in code by the G3 PR (#140):** progress records its `layout`; `planResume` refuses
    a resume unless the pages are exactly the layout's, and the run then plans only the
    ungraded students (`planRemainingBatches`), waiting on an in-flight job only if it was
    sent for exactly those students (`inFlightMatches`). Pages added, removed, reordered or
    merged in from the other device now stop and ask (`askToRegrade`).
  - **Fixed in code by the G1 PR (#144, stacked on #140):** on save, pages no SAVED row
    covers are kept on screen for the next grading (`pagesWithoutRow`, `keepForNextGrading`)
    instead of cleared with the rest: pages the other device merged in mid-grade, the rest of
    a run that stopped part-way, and rows the save skips (no answers, a cleared name). A row
    the teacher discarded counts as handled. Like `reset()`, it clears the account copy first
    (`sync.clear()`), so the saved rows cannot be merged back; the kept pages are saved as a
    new scan. Guarded by
    `tests/invariants/scan-pages-not-dropped.test.mjs`.
  - Still open (as on main): the other device writing a stale copy just after the save's
    DELETE can bring the saved rows back on both devices. And the 409 retry in
    `components/use-scan-session.ts` applies the other device's state mid-run (unchanged; holding it back was tried and removed after review, because it
    could resurrect a just-saved class and drop the other device's pages from the server).
  - Reproduced 14 Oct: the wrong-student part of G1 was the name-split path (G3's
    mechanism). With the teacher's own camera piles, group numbers follow the piles in
    order, so a page added to a pile stayed with the right student even on main.
- **G2. A front page with no name, in a stack without declared piles, joins the student before
  it** (R3; by design, `lib/teacher-class-scan.ts:270`). A child who forgot to write their name
  is graded as the previous child. The camera's "Next student" piles avoid it, but the desktop
  whole-stack upload and Import from Photos with no split do not.
- **G3. FIXED in code (G3 PR, awaiting review). A failed whole-stack upload resumed as ONE
  student, wearing the wrong name** (R3; reproduced with the lib functions, 14 Oct; guarded by
  `tests/invariants/scan-resume-layout.test.mjs`). What it was:
  - `startStackScan` grades by name (`components/teacher-class-scan.tsx:992-993`). If it fails
    partway, its progress survives, and the auto-resume (`:401-408`) runs `gradeCaptured`,
    which passes the single pile `[N]` (`:926-929`).
  - The resume is accepted. Group 0's saved answers (the first student's) then attach to one
    row holding **every page**.
  - `pickRead` names that row after the **most confidently read name in the whole stack**. In
    the reproduction, Ana's answers were pre-filled under Ben.
- **G4. FIXED (migration applied by hand 14 Oct 2026; fallback removed). The revision check
  was not atomic on Supabase** (R7). Two saves carrying the current revision that arrived
  together both passed; the second whole-workspace replace won, and whatever the first added
  was deleted.
  - The fix: `sync_workspace_if_revision` checks the revision under a row lock and syncs in
    the same transaction (`supabase/migrations/20261014120000_atomic_workspace_revision.sql`;
    `lib/teacher-server.ts:342-354`, `:481`). The reset (`replaceWorkspace`) takes the same
    path. Guarded by `tests/invariants/atomic-revision.test.mjs`.
  - Confirmed in real use on 14 Oct: 4 of 4 production saves went through
    `rpc/sync_workspace_if_revision` with 200, none on the fallback. The fallback (the
    PGRST202 branch, the check-then-write in `updateWorkspace`, the `"missing"` break in
    `replaceWorkspace`) is removed; a missing function is now a 500.
  - **Residual deadlock risk:** `initializeWorkspace` and the SQL `reset_teacher_data()` still
    call `sync_workspace` directly, which locks the child rows first and the workspace row
    last, the reverse of the locked save. Run at the same moment for one teacher, Postgres
    aborts one (a 500, rolled back, nothing half-written). `initializeWorkspace` only runs when
    there is no row, so a locked save cannot hold it. `reset_teacher_data()` is the real case,
    but nothing in the app calls it (SQL editor only), so it needs someone running it by hand
    while that teacher is saving.
- **G5. FIXED in code (#147, awaiting review). Re-scanning a student replaced their
  teacher-confirmed grades with no warning** (R6). Confirmed grades are now kept by default
  (`mergeStudentResponses`, `mergeSplitGroups`, including grades on questions the new read
  does not cover), and all three paths that re-read a student's work ask first: the class
  scan's Save, "Check student work", and the review screen's "Upload pages" / "Take a
  photo" (`components/teacher-review.tsx` `uploadPages`, which now also layers pages instead
  of replacing every answer). `tests/teacher-class-scan.test.mjs`, which had pinned the silent
  replacement as intended, was changed with a note.
- **G6. A matching-screen row with an empty name is silently not saved**
  (`components/teacher-class-scan.tsx:1021`).
  - It is reachable: the second half of a split is named `two.detectedName || ""` (`:1131`).
  - The Save count still includes the row.
- **G7. Overlapping saves are dropped with no message** (`components/teacher-app.tsx:330`).
  `save()` returns `false`; Grade by question returns early on `false` with nothing shown
  (`components/teacher-review.tsx:446`, `:458`). A fast second click can look saved and not be.
- **G8. Two custom standards with the same code fail every save** (R14; confirmed by reading
  the SQL).
  - Custom standards are unique on `(teacher_id, code)`
    (`20260909214251_tbf_21_workspace_facade_columns.sql:20-21`).
  - The catalog loader de-duplicates by framework, grade, subject **and** code
    (`components/teacher-classes.tsx:730-734`).
  - Loading two frameworks that share codes (California and Common Core both use `3.OA.A.1`)
    puts two rows with one code into the payload, and `ON CONFLICT` raises.
  - Reproduced 14 Oct on a full replay of `supabase/migrations` (PGlite): "ON CONFLICT DO
    UPDATE command cannot affect row a second time".
  - **FIXED IN CODE, MIGRATION PENDING APPLICATION:**
    `20261014130000_custom_standards_per_framework.sql` keys custom standards on
    `(teacher_id, framework, grade, subject, code)` and drops the old index (the one R9
    exception). Not live until it is applied by hand; then run
    `supabase/checks/custom-standards-round-trip.sql`.
  - Still open: the "resolve standard links" step in `sync_workspace` links a question to a
    standard by **code** only, so with one code in two frameworks the question's
    `standard_id` points at either row. Reports that group by `standard_id` could count it
    under the other framework; the app itself reads `standard_code`.
- **G9. Upload recovery could return a purged file. FIXED 26 Oct 2026:** `findUploadByHash`
  now skips rows with `purged_at` set. Still open: the purge handles only 200 rows per table
  per run, and each class-scan page creates two rows.
- **G10. The reuse cache key is looser than the read it caches.**
  - The page hashes are sorted and de-duplicated, so a reordered set gets the old order.
  - The passage is keyed by length only.
  - `answer_key` results carry the **old assessment's question ids** and are reused without
    re-running `finalizeAnalysis` (`lib/analyze-server.ts:299-322`; `app/api/analyze/route.ts:119-121`).
  - No student data is involved, but a wrong key grades everyone wrong. Today this is limited
    to async scans (§1.10).
- **G11. Custom standards lose their skills, misconception, example and DOK on reload** (R2).
  `sync_workspace` writes none of them (`20261008190000…:278-288`). The teacher's own "skills"
  field in Standards > Add (`components/teacher-insights.tsx:167`) is gone after a refresh.
  - **FIXED IN CODE, MIGRATION PENDING APPLICATION:** `20261014130000` writes skills,
    prerequisites, next, vocabulary, misconception, example, dok, source and officialCode into
    the row's `meta` jsonb, and `get_workspace_json` reads all of them back (prerequisites,
    next and vocabulary were hard-coded `[]`).
  - **Neither the defaults nor the catalog's values are frozen.** The reader and
    `normalizeStandard` fill every missing extra (skills `[]`, DOK 2, a stock misconception
    and example) from the shared catalog or a default, the client sends them back, and
    `StandardsLoader` (`components/teacher-classes.tsx`) copies catalog rows whole. Storing
    any of that would freeze a snapshot into every teacher row on its first save after the
    migration, and a later catalog refresh would never reach it. So the save stores only the
    teacher's real differences:
    - lists only when non-empty; misconception and example only when they differ from the
      stock texts (both apostrophe forms); DOK only when it is not 2;
    - and no key whose value equals the shared catalog's copy of the same standard
      (`teacher_id` null, active, same framework, grade and code -- the reader's match).
    - A row with nothing left stores `meta` NULL.
  - The reader merges per key, `catalog || teacher`: the teacher's values win, the catalog
    fills every key the teacher has not set, including a later refresh.
  - **Rule this creates: an empty or default value means "inherit from the catalog".** A
    teacher cannot clear a field to empty, or keep a value equal to an old catalog value once
    the catalog changes, where the catalog has that standard: the catalog's value shows. The
    same holds for DOK: a teacher's 2 cannot beat a catalog 3. No screen reaches any of this
    today: Standards > Add creates district standards, which have no catalog row, and nothing
    edits a saved standard's extras or DOK. A screen that edits them must store an explicit
    override first.
  - Guarded by `tests/invariants/custom-standards-key.test.mjs` (the merge; the stock texts
    and DOK match `normalizeStandard` and `get_workspace_json`; the save compares against
    the catalog row with the reader's match); proven on the database by
    `supabase/checks/custom-standards-round-trip.sql` steps 5-7 (step 7: catalog v1, teacher
    loads and saves, catalog refreshed to v2, the teacher sees v2 and keeps their own example).
- **G12. FIXED in code (G12 PR, awaiting review). An unrostered child whose name is a
  near-variant of a rostered child was pre-filled as that child** (R3; reproduced 14 Oct;
  guarded by `tests/invariants/no-near-name-prefill.test.mjs` and the near-name pairs in
  `tests/invariants/no-wrong-student.test.mjs`).
  - What it was: `matchRosterStudent`'s fuzzy tier scored "Christina Lee" against "Chris Lee"
    at 0.947, "Josefina Ruiz" against "Jose Ruiz" at 0.940 and "Danielle Kim" against
    "Daniel Kim" at 0.970, all above `PREFILL_SCORE` (0.9).
  - Now: `resolveScannedGroups` pre-fills only when `givenNameMayPrefill` holds:
    - the written given name is the roster's (case and accents aside), or a short form from
      `SHORT_FORMS` that belongs to **exactly one** full name (so "Sam" never pre-fills
      Samantha: it may be her brother Samuel). Forms that are given names in their own right
      (Liam, Leo, Jack, Bella, Nathan…) are not short forms here;
    - and, when both carry a family name, the surnames are the same, or the shorter is an
      initial or a dotted abbreviation ("C.", "Ga."): "Maria Garza" is not Maria Garcia, and
      "Amy Lin" is not Amy Li;
    - and a short form never pre-fills when the class holds a sibling it could stand for
      ("Danny Kim" with Daniel and Daniela Kim).
    - `SHORT_FORMS` is narrower than `NICKNAMES` (translations, misspellings), which still
      drives suggestions. Anything else is a suggestion, one tap away.
  - Still open:
    - a first name alone ("Maria") pre-fills the only rostered Maria (an exact given name
      by Troy's rule);
    - reversed names ("Garcia, Maria") are a suggestion: one tap per child where a school
      teaches "Last, First" -- a tradeoff to put to the teachers;
    - a roster entry that is only a first name ("Maria") fits any "Maria …" at 1.0.
- **G13. A model `blank` verdict erases text the student wrote**
  (`lib/teacher-workflow.ts:527`, `:547`). The response is scored 0, unconfirmed; only the
  photo shows the teacher it was not blank.
- **G14. FIXED in code (#143). The sign guard was off for keys with units, %, °, ±, `$`, a
  second part, or "x is"** (reproduced 14 Oct). `provablyDifferent("-12", "12 cm³")`,
  `("-50%", "50%")`, `("±3", "3")` and `("2; -3", "2")` were all `false`, and `compareAnswers`
  said "same" for `"x is 5"` vs `"x is 6"`. Now a lone number or a list of numbers is read past
  its label and unit (`quantity`, `valueList` in `lib/math-answer.ts`); anything those cannot
  read falls back to the old check, never to "different". Guarded by
  `tests/invariants/sign-guard-units-parts.test.mjs`. Still not caught: "5" for "5/x" (a
  different variable is not a provable difference in value).
- **G15. Camera shots are deleted from the device before they upload**
  (`components/scan-camera.tsx:671`, then upload in `components/teacher-class-scan.tsx:544-573`).
  An upload failing partway loses the remaining pages.
- **G16. Student work outlives the 48-hour purge on devices and in sessions.**
  `class_scan_sessions` keeps transcribed answers and names read for 7 days; the localStorage
  draft is expired only when it is read; camera shots in IndexedDB never expire. All of them
  sit on shared school devices. Check `docs/student-data-flow.md` against this.
- **G17. FIXED in code (#140). A stack upload followed by camera piles lost the camera piles'
  boundaries** (R3; #140 review). Now only the stack pile is split by names
  (`groupMixedPiles`); guarded by `tests/invariants/scan-resume-layout.test.mjs`.
- **G18. FIXED in code (G18 PR). "Replace writing" discarded confirmed rubric scores with no
  count or confirmation** (R6; #147 review). It now asks Keep / Replace / Cancel with the count
  of confirmed trait scores, and keeps them unless the teacher chooses Replace (see R6). Manual
  answer entry in `components/teacher-scan.tsx` still overwrites confirmed answers with what the
  teacher types (deliberate, noted).
