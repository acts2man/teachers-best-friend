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

**What "answer reading" can and cannot tell you.** The app keeps no field for "the
student actually wrote X" when a read is wrong, so the confirmed final answer is the
earlier read wherever the teacher did not change it. Answer reading therefore measures
agreement with the read the teacher accepted. The **credit** the teacher gave is the
independent ground truth: wrongly-correct, wrongly-blank and "full credit not
pre-marked" are judged against it, and grouping is judged against the teacher's actual
groups (same answer *and* same credit), so a group the teacher had to split counts as
a miss. `answer_reading` and `grouping` on the same assessment share one grading pass
in a run.

**How an answer is judged** (`lib/regression/compare-answers.ts`, since 14 Oct 2026).
The question is whether the replay got it right, not whether it spelled it like the
teacher. Before comparing, each `;`-separated part has these removed:

- spacing;
- a Unicode minus;
- `$` and thousands separators;
- labels such as `x=`, `A(t)=`, `domain=` or `y-intercept:`. A label that carries meaning
  still has to match when both sides have one: `max` against `min`, `vertex` against
  `x-intercept`, `P(5)` against `P(6)`. Its wording does not have to match: `y-int` is
  `y-intercept`. A bare variable or function name is not compared;
- the working before the final value of a labelled chain (`A(8) = 1200(1.02)^8 =
  1405.99`). An unlabelled equation (`2x+3y=6`) stays whole.

Each part is then compared with the same code grading uses (`lib/math-answer.ts`). Rules
that keep the comparison strict:

- **No rounding tolerance.** Where both sides give an exact form before `≈`, the exact
  forms must agree too, so `22/7 ≈ 3.14` is not `π ≈ 3.14`. One side's exact form may
  match the other's single value (`ln(7)/2` against `ln(7)/2 ≈ 0.97`).
- **Several solutions** are compared item by item, never cut to the last one. One
  variable's solutions (`x=5 or x=-5`, `±3`) may come in any order. A system's
  (`x=2, y=3`) pair up by variable, so swapped values are wrong.
- **An extra value in a read** (`-5; 5` for `5`) is wrong; only extra description is allowed.
- **Anything with words in it** is compared as text, never by value. Words that read
  differently are a human check when the numbers in them agree (`all reals` against
  `(-∞,∞)`), and wrong when they do not.
- **Units.** When both sides name units, they must name the same ones.

Each answer gets one of four results:

| Result | When | How it counts |
|---|---|---|
| **Right** | The same answer | Right |
| **Parts missing** | A multi-part read kept only some parts, each one right | Read faithfully, listed separately as missing parts |
| **Needs a human check** | Prose (a description, a sketch) that reads differently but has the same numbers in it | Not counted as a miss; both texts shown side by side on the replay page. Prose with different numbers is wrong |
| **Wrong** | Anything else | A miss |

Pass marks (`lib/regression/score.ts`): names 92% (24 of 26) with **zero** pre-filled
wrongly; answers 95% with **zero** wrongly-correct and **zero** wrongly-blank. Accuracy
counts everything that is not a miss, so an answer waiting on a human check does not
lower it. The page always says how many are waiting.

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
5. **Copy the photos as soon as the scan is saved, before the teacher confirms.**
   Confirming a student's grading can delete that student's photos (the published
   "deleted once you confirm" rule), so a set copied afterwards may be missing exactly
   the students the teacher finished. Each copied page records which student it was
   saved to, so the case keeps them after their pages are unlinked.
   Paste the assessment id, press **Copy photos** (it copies a few per request until
   none are left; photos already removed by the 30-day purge are reported, not copied),
   then, once the teacher has confirmed the grading, **Make cases**. A kind the teacher
   has not confirmed is skipped with the reason.
6. Press **Run test cases**. Each case shows its numbers as it finishes; the run is saved
   in `regression_runs` with the build, the `pipeline_config` snapshot, and per case:
   pass/fail, accuracy by stage, multi-part parts read vs expected, cost, model and effort.
7. To withdraw a set, press **Revoke set** (it deletes the copied files, then the
   allow-list row, which removes its fixtures and cases).
   A teacher who presses "delete my workspace data" withdraws every set of theirs the
   same way, and deleting their account removes the copied files too.

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
