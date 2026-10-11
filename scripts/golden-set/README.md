# Golden-set AI eval

A fixed set of real worksheets the founders have already graded and confirmed,
used to measure how well each AI stage does — and to compare settings before
changing any (names model, answer-key effort/model, grading effort/batch size).

**Read-only.** The runner never writes to the database, never changes
`pipeline_config`, and tells the provider to store nothing (`store:false`). No
student names or work are committed to the repo — the set
(`manifest.json`) is IDs only, and the runner fetches the confirmed answers and
images from production at run time.

## The set (all confirmed by the teacher)

- **Names** — Michael's `scan-1-1` (26 students; the matches he confirmed are
  the right answers).
- **Answer keys** — Ricky's Rational Expressions (the Algebra 2 exam),
  Percentages, and Michael's scan-1-1.
- **Grading** — scan-1-1 (286 confirmed verdicts) and Percentages (100).

## What it compares (the P3 experiments)

- **Names:** current `gpt-5.4-nano` vs `gpt-5.6-luna` (same price) vs `gpt-5.4-mini`.
- **Answer key:** effort low / medium / high; a stronger model; and **solving
  the key in its own call** instead of folding it into the one worksheet read.
- **Grading:** effort low vs medium; and **smaller batches** (3 students).

It prints accuracy and cost per 26-student class set for each. It does **not**
change any setting — you apply the winners by hand in `pipeline_config`.

## How to give it a key (safest way, no coding)

The runner needs two secrets. Put them in **GitHub → the repo → Settings →
Secrets and variables → Actions → New repository secret**. Secrets there are
encrypted by GitHub, are never printed in logs, and never live in the code:

1. `OPENAI_API_KEY` — the AI provider key.
2. `SUPABASE_URL` — `https://mmzbgmquhfdfqaootrvh.supabase.co`.
3. `SUPABASE_SERVICE_ROLE_KEY` — from Supabase → Project Settings → API. The
   runner only reads with it; keep it a secret (it is powerful) and rotate it if
   it is ever exposed.

Then run it: **GitHub → Actions → "Golden-set AI eval" → Run workflow**. When it
finishes, open the run and download the **golden-set-report** artifact for the
numbers. Nothing else is needed, and it only runs when you click Run.

Prefer a dedicated, spend-capped provider key for this so a bad loop can't run
up a bill.

## What a run costs

Small. The names stage on scan-1-1 is about **$0.11** total (nano ≈ $0.019,
luna ≈ $0.019, mini ≈ $0.07). The answer-key and grading experiments add a few
cents each; the dearest arms are `mini` and the stronger `sol` model. A full run
of all stages and experiments is roughly **$1–2** — a rough estimate from the
measured token sizes and the `model_pricing` table, not a quote. Re-running one
stage (`names` only, say) costs a fraction of that.

## First run (confirm once, then trust)

The runner is faithful to production — the name prompt mirrors
`lib/analyze-shared.ts` at `READ_PROMPT_VERSION` 4, and the exact strip/page
images and their order come from the stored scans, not guessed. Two things to
confirm on the first supervised run:

- **Grading replay** is deliberately left to fail loud (it reports the confirmed
  set size and stops short of a grading accuracy) until the `class_scan` replay
  is wired against `lib/teacher-class-scan.ts`’s batching, so it never invents a
  number. Names and answer key run fully.
- If a stage errors on a storage download, the upload may have aged out
  (`teacher_uploads.expires_at`); pick a more recent confirmed assessment.

Keep the scoring honest: `score.mjs` holds all the accuracy and cost maths and
is unit-tested (`tests/golden-set.test.mjs`), so the numbers the report prints
are trustworthy even though the run itself happens in CI.
