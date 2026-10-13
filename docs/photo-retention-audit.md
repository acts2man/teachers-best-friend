# Photo deletion on confirm: what the code does (13 Oct 2026)

A report, not a change. Requested in round 3: "The privacy policy says photos are
deleted when the teacher confirms a student and after 30 days at most. In the
database, none of the pilot teacher's ~400 uploads were purged on confirm, though the
30-day purge runs. Report exactly what the confirm path does to the files and the
teacher_uploads rows. Don't change behaviour yet."

Code read on `main` at c11df12. Production was checked with read-only, aggregate
queries; no names, answers or file paths were read. The database was restored on
12 Oct to its 05:54 PT state, so anything between then and about 17:36 PT that day
is missing from these counts. Teachers are "pilot teacher A" and "B" here.

## The short answer

- [VERIFIED] **One button deletes photos on confirm**: "Confirm N clear answers" in the
  one-student review (`approveClear`, `components/teacher-review.tsx`). It shows only
  while that student still has unconfirmed clean answers.
- [VERIFIED] **Every other way of confirming deletes nothing**: Grade by question
  (giving a group or one student credit), the green "Confirm / Lock in matches",
  No / Half / Full credit on one answer, the edit-answer sheet, and the writing
  rubric's confirm. The guided path the app now sends teachers down -- scan, match
  names, Grade by question, class analysis -- never reaches the deleting button.
- [VERIFIED] **Most uploads are linked to no student at all** (382 of 512 live), so no
  confirm could reach them: the name-area copy of every class-scan page is uploaded
  as its own file and never recorded on the assessment, and pages from discarded or
  unsaved scans are never linked. Only the 30-day job removes those.
- [VERIFIED] **The 30-day job works**: it runs daily at 09:00 UTC, removes the actual
  files through the Storage API, and marks the row `purged_at`. No live row is past
  its expiry; no purged row still has a file; no file lacks a row.

## The one deleting path, step by step [VERIFIED]

1. "Confirm N clear answers" marks that student's clear answers confirmed.
2. `releasedStudentUploads` (`lib/teacher-workflow.ts`) then checks *every* student on
   the assessment: a student's pages are released only when every active question has
   an answer and every answer is confirmed. A clean AI match that counts toward the
   score without being confirmed does not qualify. A page shared with an unfinished
   student is held back.
3. The released pages are taken off the assessment and the workspace is saved; only
   if that save succeeds, `deleteUploads` sends `DELETE /api/uploads/{id}` per page.
4. The route removes the file from the `teacher-documents` bucket and **deletes the
   `teacher_uploads` row**. A failure is counted, and the teacher sees "N scanned pages
   couldn't be deleted just now. They'll be removed automatically" -- the 30-day job
   then collects the file.

## What the published pages promise [VERIFIED]

- `content/legal/how-we-use-ai.md`: "A student's scanned pages are deleted as soon as
  you confirm that student's grading ... deleted automatically 30 days after upload
  regardless."
- `content/legal/privacy.md`, `student-data-privacy.md`, `dpa.md`: "Deleted as soon as
  you confirm that student's grading, and automatically 30 days after upload in any
  case."
- `docs/student-data-flow.md`: "Confirming a student's grading deletes that student's
  scanned pages straight away."
- The green bar's own text says confirming "frees up the photos"; it does not.

So the 30-day promise holds; the "as soon as you confirm" promise holds only on one
route that the app no longer steers teachers to.

## Production, in numbers (aggregate)

| | Pilot teacher A | Pilot teacher B |
|---|---|---|
| Live uploads | 289 | 223 |
| Linked to a student's pages | 88 | 16 |
| ... of those, the student fully confirmed | 8 | 16 |
| Linked to nothing | 178 | 204 |
| Students with pages / fully confirmed | 43 / 4 | 8 / 8 |

[VERIFIED] 206 charged uploads no longer have a row, which only the app's delete path
(or account deletion) does -- so confirm-deletion has worked at times; for teacher B,
18 fully confirmed students' page lists are empty. [INFERRED] Some of teacher A's
grading may have been lost in the 12 Oct restore.

## Fix options (none implemented)

- **A. Release on every confirm.** One shared step after every save that confirms an
  answer (group credit, one student, the green bar, single-answer credit, the edit
  sheet, writing). Small. Still runs in the browser, so a tab closed between save and
  delete leaves the files for the 30-day job.
- **B. Delete the name-area copy once the name is read**, and the pages of a scan that
  is discarded or reset. Covers most of the 382 unlinked files. A nightly sweep of
  "linked to nothing, older than N hours" would be a new retention rule, to be checked
  against the published pages first.
- **C. Do it on the server**, in the workspace save or a nightly job that compares
  uploads with confirmed students. Does not depend on the browser.
- **D. Change the published wording** (all of `content/legal/*` and
  `docs/student-data-flow.md` together) if deletion is meant to follow something else,
  such as class analysis. The green bar's "free up the photos" is wrong under any option.
