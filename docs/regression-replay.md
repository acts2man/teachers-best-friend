# The in-app regression replay

Real, teacher-confirmed cases, replayed through the live app after every AI change, so a
change is measured on the founders' actual papers before anyone says it worked.

It runs **inside the app**, on the server, with the OpenAI key that already lives in the
Netlify environment. Nothing runs in GitHub Actions and no key is stored anywhere new.
The old golden-set workflow is retired (`scripts/golden-set/README.md`).

## What a case is

A **case** is one thing to check on one real assessment, with what the teacher confirmed
in the app as the expected answer (`regression_cases`, private):

| Kind | Checks | Expected value comes from |
|---|---|---|
| `names` | each scanned pile is assigned to the right student; none pre-filled wrongly | the student each pile was saved to |
| `answer_reading` | the final answer read matches the confirmed one | the confirmed answers (unconfirmed ones are left out) |
| `grouping` | each answer lands in the confirmed group; counts wrongly-correct, wrongly-blank, Unsure, equivalent-but-split | the same, plus the credit the teacher gave |
| `answer_key` | the worksheet read produces the confirmed key | the key, once the teacher confirmed it |
| `standards` | each question gets the teacher's standard | the standards on confirmed questions |

A case snapshots everything its prompt needs (questions, key, roster names) when it is
made, so it keeps meaning the same thing if the teacher later edits or deletes the
assessment.

Pass marks (`lib/regression/score.ts`): names 92% (24 of 26) with **zero** pre-filled
wrongly; answers 95% with **zero** wrongly-correct and **zero** wrongly-blank.

## What it shares with production

Everything that decides the answer: the live `pipeline_config` row, the prompt and schema
(`buildPrompt`), the request body and retries (`startModelBackground`), output validation
(`finalizeAnalysis`), the name-pass batching and mapping, name matching
(`resolveScannedGroups`), grading batches and the short-batch re-ask, and what would be
saved for each answer (`normalizeRecognizedResponses`). The full list is at the top of
`lib/regression/runner.ts`.

What it deliberately skips: charging, the `scans` row, and **reuse** -- every replay is a
fresh read, never a cached one.

## The function time limit, and how the runner stays inside it

- **What the code assumes:** `maxDuration = 26` on every analyze route, and comments that
  Netlify "caps at 26s for a synchronous invocation".
- **What Netlify's own documentation says today:** a 60-second synchronous limit (search
  of docs.netlify.com, 12 Oct 2026). Older forum answers say 10s by default, 26s on
  request.
- **What this site actually has:** not confirmed. This session had no access to the
  Netlify dashboard. Check *Site configuration → Functions* before relying on more than 26s.

The runner is built for the strictest of those numbers. One class-scan batch takes 30–47s
of model time (measured on production scans, 10 Oct–12 Oct), so it never waits for one in
a single request. Each request does exactly one of:

- plan the case (a few queries);
- start one background AI job: bounded at 20s (`BACKGROUND_START_BUDGET_MS`), the same
  budget a teacher's request has;
- poll one job: bounded at 18s (`POLL_BUDGET_MS`).

Progress is saved in `regression_run_cases.state` after every step, and the page calls
again every 2.5s until the case is done. A run of any length is many short requests.

## Before the first case: the data decision

Copying photos keeps them **past the published 30-day window**. Read
`docs/student-data-flow.md` section 8 first. Until the four published pages describe
this, allow-list **only synthetic sets** (papers a founder wrote for testing, with
invented names).

## Steps for an admin

All SQL runs in the Supabase SQL editor (project `mmzbgmquhfdfqaootrvh`).

1. **Apply the migration** `supabase/migrations/20261012190000_app_events_and_regression_replay.sql`
   (once, before the PR merges).
2. **Put yourself on the replay allow-list.** You must already be an admin.
   ```sql
   insert into public.regression_admins (user_id, note)
   select id, 'replay access' from auth.users where email = '<your admin email>';
   ```
3. **Record the teacher's agreement for one assessment.** The assessment id is the `id=`
   in the address bar when the assessment is open.
   ```sql
   insert into public.regression_fixture_allowlist (teacher_id, assessment_legacy_id, consent_note, added_by)
   select a.teacher_id, a.legacy_id,
          '<who agreed, when, and where -- e.g. "Ricky, Slack #testing-and-bugs, 12 Oct">',
          (select id from auth.users where email = '<your admin email>')
   from public.assessments a where a.legacy_id = '<assessment id>';
   ```
4. **Open `/regression`** in the app. Anyone not on the list sees a 404.
5. Paste the assessment id, press **Copy photos** (it copies a few per request until
   none are left; photos already removed by the 30-day purge are reported, not copied),
   then **Make cases**. A kind the teacher has not confirmed is skipped with the reason.
6. Press **Run test cases**. Each case shows its numbers as it finishes; the run is saved
   in `regression_runs` with the build, the `pipeline_config` snapshot, and per case:
   pass/fail, accuracy by stage, multi-part parts read vs expected, cost, model and effort.
7. To withdraw a set, run the revoke action (it deletes the copied files, then the
   allow-list row, which removes its fixtures and cases).

## What a run costs

Worked out from production scans made after the 12 Oct `pipeline_config` change (class_scan
and assignment on medium effort, name_strip on luna). It is scaled up from those, not
measured on a replay:

| Stage | Measured | For a 26-student, 52-page set |
|---|---|---|
| Grading (`class_scan`) | $0.0103 per 8-page request (4 requests) | about **$0.07** |
| Name pass (`name_strip`) | $0.0033 per request (4 requests) | about **$0.015** |
| Worksheet read (`assignment`) | $0.0053 per 2-page read (2 reads) | about **$0.005** |

So one run of every kind of case on one class set costs about **$0.10**. The replay records
the actual cost per case in `regression_run_cases.cost_usd`.
