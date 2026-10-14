# System map

**Read this before changing anything. Update it in the same PR when behaviour changes.**

Last verified against the code: **2026-10-14, `main` at `831aa25`** (#134 merged). Every
claim cites `file:line` as of that commit. Line numbers drift; the function names do not, so
search by name when a line has moved. Anything not checked against the running system says
so. Migrations listed here are the repo's copies; production is applied **by hand**
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
| "Next student" starts a new pile. **The piles are the teacher's own student boundaries.** | `components/scan-camera.tsx:658-661`, `lib/camera.ts:222-230` |
| Done: shots are partitioned by pile, **IndexedDB is cleared, then the pages are handed off for upload** | `components/scan-camera.tsx:663-675` (clear at `:671`, hand-off at `:674`) |
| Photo import: EXIF order; default split is **2 pages per student** until the teacher fixes it | `lib/photo-import.ts:14`, `:169-188`; `components/photo-import.tsx:55`, `:90-91` |
| Page prep: upright, long edge ≤ 2000px, plus a separate **name-area copy (top 45%)** | `lib/image-prep.ts:128-140`, `:155-181`, `NAME_AREA` `:35` |

### 1.2 Upload and storage

- Each page is **two uploads**: the whole page (body) and the name strip. See `preparePage`
  (`components/teacher-class-scan.tsx:458-476`, uploads at `:470` and `:474`).
- `uploadFile` (`lib/upload-client.ts:35-52`) POSTs to `/api/uploads`
  (`app/api/uploads/route.ts:32-87`). The route checks the size (8 MB), the MIME type and the
  magic bytes, then calls `saveDocument`.
- `saveDocument` (`lib/teacher-server.ts:485-551`):
  - stores the file in bucket **`teacher-documents`** at `<ownerId>/<id>`;
  - inserts a **`teacher_uploads`** row with `page_count` and `content_sha256`.
- An insert trigger refuses a row with no hash
  (`supabase/migrations/20260923170000_a_scan_cannot_exist_uncharged.sql:158-178`).
- Recovery after a lost reply: `findUploadByHash` (`lib/teacher-server.ts:617-640`). It does
  **not** filter out purged rows; see gap G9.

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
- **Banked progress.** Progress is saved after each batch as `{graded, nextBatch, scanId,
  layout, inFlight}` (`setProgress` in `gradePages`, `components/teacher-class-scan.tsx`), keyed by
  **whole-scan group index**. `layout` is the body upload ids of every group those indexes
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
  with fit ≥ 0.9 **and** the name was read at ≥ 70% (`PREFILL_SCORE` `:644`, `PREFILL_READ`
  `:648`, applied at `:825-826`). Anything weaker becomes a suggestion or a list of candidates
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
2. `applyScannedGroups(a, students, classroom.id, rows)` (`:1040`; lib `lib/teacher-class-scan.ts:997-1089`):
   - creates a student for each row with no `studentId`, or whose student has been removed
     since (`:1013`, `:1022-1041`);
   - maps verdicts through `normalizeRecognizedResponses` (`lib/teacher-workflow.ts:496-556`);
   - the first row for a student is merged with **previously saved** responses through
     `mergeStudentResponses` (`lib/teacher-workflow.ts:712-721`). **A re-read answer replaces
     a teacher-confirmed one** (gap G5). Two rows of one scan are merged with `mergeSplitGroups`
     (`:973-995`);
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
6. `updateWorkspace` (`lib/teacher-server.ts:450-469`). On Supabase:
   - read the revision (`:456`);
   - refuse if it differs (`:457`);
   - otherwise call `sync_workspace` (`:458`, RPC at `:322-331`).
   - **The check and the write are separate round trips**: gap G4.
7. `sync_workspace(p_teacher, p_data)` is the current body as rebuilt by
   `tests/invariants/lib/workspace-sql.mjs`: the whole definition in
   `supabase/migrations/20261008190000_points_final_answers_stable_order.sql:37-317`, plus the
   patches in `20261012200000` (answerParts), `20261013120000` (gradedAlone) and
   `20261013130000` (secondChoice). For each table it **upserts the rows it is sent and deletes
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
   | standards (custom) | `:288` |

   - Responses are inserted through **inner joins** on the question and the student
     (`:188-189`). A response whose question or student is missing from the payload is
     silently not saved.
   - Responses upsert `on conflict (question_id, student_id)` (`:191`). Custom standards upsert
     `on conflict (teacher_id, code)` (`:283`). **Two payload rows hitting the same key fail the
     entire save** (rule R14; gap G8).
   - The function then bumps `teacher_workspaces.revision` (`:301-306`).

### 1.9 Reload

- `GET /api/workspace` (`app/api/workspace/route.ts:90-115`) calls `readWorkspace`
  (`lib/teacher-server.ts:413-432`). It reads the **revision first, then the data**, so a save
  in between shows up as a 409 on the next PUT.
- `get_workspace_json` (`20261008190000…:320-468` plus the three patches) builds the JSON from
  a **fixed list of columns**. `jsonb_strip_nulls` removes null keys.
- `normalizeWorkspace` (`lib/teacher-server.ts:378-411`) and `withAssessmentDefaults`
  (`lib/workspace-safety.ts:24-32`) put back the defaults a stripped key loses.
- The client copy is refreshed when it is older than 2 minutes or the tab becomes visible
  again (`components/teacher-app.tsx:94`, `:198-245`).

### 1.10 The reuse cache

- Only for `assignment`, `passage`, `roster` and `answer_key` reads (`lib/analyze-server.ts:236-241`).
  **Never for grading or names**, so it cannot move a grade onto a student.
- **Key.** `reuseFingerprintKey` (`lib/analyze-server.ts:299-322`) uses: the prompt version;
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
- **Known exception:** `Standard`'s skills, prerequisites, next, vocabulary, misconception,
  example, dok and source are **not saved** (gap G11). They are allow-listed in the test so
  the loss stays visible.

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
- **Open:** gaps G1 (pages merged in mid-grade), G2 and G12 are ways this rule breaks
  today. G3 is fixed in code (#140); the resume is guarded by
  `tests/invariants/scan-resume-layout.test.mjs` (`planResume`, `planRemainingBatches`,
  `inFlightMatches` in `lib/scan-session.ts` / `lib/teacher-class-scan.ts`).

**R4. Never mark an answer correct when it is wrong; never mark it blank when the student wrote something; uncertain goes to Unsure.**
- **Why:**
  - 8 Oct 2026 (d2a02c5, Michael's class): questions the model skipped were scored blank for
    students who had written work.
  - 12 Oct 2026 (#125, Ricky): sign-flipped answers, mostly in LaTeX, were matched to the key.
- **Enforced by:**
  - Credit comes **only** from the model's `match`, mapped in `normalizeRecognizedResponses`
    (`lib/teacher-workflow.ts:496-556`).
  - A match is taken away when `provablyDifferent` says so (`lib/math-answer.ts:444`, used at
    `teacher-workflow.ts:508-509`).
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
    `tests/confirm-matches-confidence.test.mjs`.
- **NO TEST YET:**
  - "never blank when written": a model `blank` verdict on an answer that has text still wipes
    the text (gap G13);
  - the guard is off for keys with units, %, °, ± or parts (gap G14).

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
- **NO TEST YET:** re-**scanning** students' work replaces teacher-confirmed grades with no
  confirmation (gap G5).

**R7. A stale browser tab never overwrites newer data.**
- **Why:** every save replaces the whole workspace (R1), so a tab that loaded before another
  tab's save would delete what that save added. No incident is recorded: the guard predates
  this repository's history (23 Sep 2026).
- **Enforced by:**
  - the revision check in `updateWorkspace` (`lib/teacher-server.ts:456-457`) and the 409 in
    the route (`app/api/workspace/route.ts:170-175`);
  - `readWorkspace` reads the revision before the data (`lib/teacher-server.ts:413-424`).
- **Guarded by:** `tests/invariants/stale-revision.test.mjs`, which runs the real
  `updateWorkspace` against an in-memory database.
- **NO TEST YET:** two saves carrying the same current revision at the same moment can both
  pass (gap G4).

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
    dropped policy or trigger must be re-created in the same file;
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
    (`20261012200000…:41`, `20261013120000`, `20261013130000`);
  - the `safe_int`, `safe_numeric`, `safe_bool` and `safe_date` casts.
- **Guarded by:** `tests/assessment-title-and-empty-read.test.mjs`.
- **NO TEST YET:** `createdAt` is cast with a bare `::timestamptz`
  (`20261008190000…:119`), so a malformed `createdAt` fails the whole save.

**R14. One save never holds two rows for the same database key.** `ON CONFLICT DO UPDATE`
fails the whole save if one statement touches the same row twice.
- **Enforced by:** `normalizeRecognizedResponses` emits one response per question
  (`lib/teacher-workflow.ts:501`); `mergeSplitGroups` merges two rows for one student
  (`lib/teacher-class-scan.ts:973`).
- **Guarded by:** `tests/invariants/no-wrong-student.test.mjs` (no student and question pair
  saved twice).
- **NO TEST YET:** custom standards with the same code (gap G8).

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
  - **Still open (the G1 PR):** the other device's pages can be merged into the piles while
    this device grades (`components/use-scan-session.ts` 409 handler applies even while
    paused). The run grades its own copy, so those pages get no row on the matching screen
    and are dropped on save with no message.
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
- **G4. The revision check is not atomic on Supabase** (R7; `lib/teacher-server.ts:456-458`).
  Two saves carrying the current revision that arrive together both pass; the second
  whole-workspace replace wins, and whatever the first added is deleted. The fix is for
  `sync_workspace` to take the expected revision and check it under a row lock.
- **G5. Re-scanning a student replaces their teacher-confirmed grades with no warning** (R6;
  confirmed by reading the code).
  - `mergeStudentResponses` keeps a prior response only when the new answer is blank
    (`lib/teacher-workflow.ts:719`).
  - The new response is unverified, has a new id, and drops `errorType`, `gradedAlone` and
    the teacher's credit. `tests/teacher-class-scan.test.mjs` asserts this as intended.
  - #134's confirmation covers re-reading questions, not re-scanning student work.
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
- **G9. Upload recovery can return a purged file.** `findUploadByHash` ignores `purged_at`
  (`lib/teacher-server.ts:617-640`), so the scan later fails with a 404. The purge also
  handles only 200 rows per table per run, and each class-scan page creates two rows.
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
- **G12. An unrostered child whose name is a near-variant of a rostered child is pre-filled as
  that child** (R3; reproduced 14 Oct).
  - `matchRosterStudent`'s fuzzy tier scores "Christina Lee" against "Chris Lee" at 0.947, and
    "Josefina Ruiz" against "Jose Ruiz" at 0.940. Both are above `PREFILL_SCORE` (0.9).
  - A first name alone ("Maria") pre-fills the only rostered Maria at 0.9.
  - Siblings, a new student or a twin missing from the roster all hit this.
- **G13. A model `blank` verdict erases text the student wrote**
  (`lib/teacher-workflow.ts:527`, `:547`). The response is scored 0, unconfirmed; only the
  photo shows the teacher it was not blank.
- **G14. The sign guard is off for keys with units, %, °, ±, `$`, a second part, or a
  different variable** (reproduced 14 Oct).
  - `provablyDifferent("-12", "12 cm³")`, `("-50%", "50%")`, `("±3", "3")` and `("2; -3", "2")`
    are all `false`, so a model's wrong "match" stands.
  - The comment at `lib/math-answer.ts:440-441` claims "5 vs 5/x" is caught; it is not.
  - `compareAnswers` (the answer-key check) says "same" for `"x is 5"` vs `"x is 6"` and for
    `"x = 3, x = -3"` vs `"x = 3"`.
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
