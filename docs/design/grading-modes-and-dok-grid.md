# Grading modes and the DOK grid -- design

Status: **design only. Nothing in this document is built.** Written 19 Oct 2026
against `main` at be082de. It uses the level names and the rounding rule of
#166 (Ricky's level updates, still open): the lowest level is **Beginning**, and
a level is read from the rounded number that is shown.

Two parts, for Ricky:

1. **Grading modes.** Each test is graded either as a **Percentage** (today) or
   with **Standards-Based Grading** (every question out of 4).
2. **The DOK grid.** For each test, a grid with standards down the side and
   DOK 1–4 across the top. Each cell is the class's score, coloured by level,
   with its recommendation and a next step aimed at that cell's common errors.

Part 3 lists the questions for Ricky and estimates how many PRs each part takes.

Every claim about today's code cites a file and function. Line numbers are
at be082de.

---

## 1. Grading modes: Percentage and Standards-Based Grading

### 1.1 How a test is scored today

**Every answer's credit is a single percentage.**
- A response's credit is `match`, a number from 0 to 100 (`StudentResponse.match`, `lib/teacher-types.ts:94-95`).
- `correct` is `match >= 100`.
- `responseMatch(r)` (`lib/teacher-metrics.ts:36`) reads it as `match ?? (correct ? 100 : 0)`, clamped to 0–100.

**Partial credit is just a `match` below 100.** It is set in one of two ways:
- **Credit buttons.** `CREDIT_LEVELS` (`lib/teacher-workflow.ts:1233`) are No credit 0, Half 50 and Full 100. `applyGroupScore` (`:1239`) writes the rounded `match` to every answer in a group and marks them `verified`. Full credit clears the error type.
- **Points.** In Grade by question the teacher enters "__ of N points" (`CreditForm`, `components/teacher-review.tsx:1001`). `creditForPoints` (`lib/teacher-workflow.ts:295`) turns that into `earned / questionPoints * 100`.

**The Full / Partial / No credit grouping** is `questionSummary` (`lib/teacher-workflow.ts:1032`):
- no credit: blank or `match <= 0`
- full: `match >= 100`
- partial: anything in between
- needs a decision: still undecided

`groupAnswers` (`:1084`) splits answers that were given different credit into separate groups. It keys each group by `answer | round(match)`.

**A student's score on a test.** `studentReview` (`lib/teacher-workflow.ts:301`) computes it:
- `score = round(100 × earned / possible)` over the answers that count (verified, or a clean AI match; see `countsAsGraded`, `:161`).
- Each question is worth `questionPoints` (`:241`): its own `points`, else its share of `pointsPossible`, else 1.
- So today a test score is **weighted by points**.

**What the AI returns.** The AI never gives partial credit:
- Its grading verdict is `match | blank | other | unsure` (`lib/analyze-shared.ts:322`), and the prompt says "Do NOT assign partial credit" (`:195`).
- `normalizeRecognizedResponses` (`lib/teacher-workflow.ts:497`) maps:
  - `match` → 100
  - `blank` → 0
  - `other` / `unsure` → undecided (the teacher decides)
- **Writing is the exception.** The AI scores each rubric trait from 0 up to that trait's maximum, and the app stores both:
  - the raw level, as `rubricScore`;
  - the percentage, as `match = score / max × 100` (`normalizeWritingScores`, `:582`; `setWritingScore`, `:688`).

**Where it leads.** When a test is confirmed, `reconcileEvidence` (`lib/teacher-data.ts:683`) writes one evidence record per standard, as a percentage:
- `score = round(mean(match))` over verified answers, not weighted by points.
- Evidence feeds everything that spans tests: the heatmap, the student page, groups, and the student cards.
- `evidence.score` is held to 0–100 by the save schema (`app/api/workspace/route.ts:56`) and by the column `student_evidence.score numeric(5,2)`.

### 1.2 What Standards-Based Grading (SBG) means here

The teacher picks a mode per test, with a switch on the test, and can change it at any time.

| | Percentage (today) | Standards-Based Grading |
|---|---|---|
| One answer | 0–100% credit (Full / Half / No, or points) | **0, 1, 2, 3 or 4** |
| Question worth | its own points | **4, locked** (the points editor is hidden) |
| Student's test result | points-weighted percentage | **average of the 0–4 scores**, one decimal |
| Levels | Beginning <69.5, Approaching 69.5–79.4, Proficient 79.5–89.4, Exceeding 89.5+ | Beginning <1.95, Approaching 1.95–2.94, Proficient 2.95–3.44, Exceeding 3.45+ |

**The SBG cuts follow the same rule as #166.** They are exactly "round to one decimal, then read the level":
- 1.9 and below is Beginning;
- 2.0–2.9 is Approaching;
- 3.0–3.4 is Proficient;
- 3.5–4.0 is Exceeding.

A student's 1.95 shows as "2.0" and is Approaching, just as 69.5% shows as "70%". The number shown and the level always agree, as in #166.

### 1.3 One stored value, two ways of reading it

**The key decision is that the stored data does not change between modes.** The mode is a way of *reading* each answer's `match`, not a second copy of it:

- An SBG score `s` (0–4) is stored as `match = s × 25`: 0, 25, 50, 75 or 100.
- The same answer read in SBG is `s = match / 25`.

Writing tests already work this way: the raw level is shown and `match` carries the percentage. Because of that, everything that reads `match` keeps working in both modes: evidence, reports and grouping.

**How today's credit maps to 0–4:**

| Today | `match` | SBG score |
|---|---|---|
| Full credit | 100 | **4** |
| Half | 50 | **2** |
| No credit / blank | 0 | **0** |
| Points: 1 of 4, 2 of 4, 3 of 4 | 25 / 50 / 75 | **1 / 2 / 3** |
| Points that do not land on a quarter: 1 of 3 (33), 2 of 3 (67), 1 of 5 (20)… | 33 / 67 / 20 | **shown as the nearest whole score (1 / 3 / 1)**, marked "converted -- check" |
| AI `match` / `blank` | 100 / 0 | 4 / 0 |
| AI `other` / `unsure` | undecided | **undecided**: the teacher picks 0–3 |

**Switching a test between modes:**

- **Switching loses nothing.** No `match` value is rewritten, and no question's `points` is touched. In SBG the points are simply ignored (every question counts 4); switching back to Percentage reads them again.
- **Switching back gives the same result.** Percentage → SBG → Percentage, with no grading in between, shows exactly the scores it showed before, because nothing was written.
- **Grading in a mode is a real change.** If the teacher, in SBG, sets an answer to 3, that answer's `match` becomes 75, and it reads as 75% in Percentage. This is the teacher changing a grade, not the switch changing it.
- **A "converted" score is display-only until the teacher confirms it.** An answer graded 2 of 3 points (67) shows as "3, converted -- check" in SBG. It stays 67 underneath until the teacher presses a 0–4 button. So switching to look, and switching back, still changes nothing.
- **The same answers can give different levels in the two modes.** This is by design, because the cuts differ. An average of 2.5 is Approaching in SBG, and 62.5% is Beginning as a percentage. The switch will say so in one line: "Levels are worked out differently in each mode -- a student's level on this test can change when you switch."

### 1.4 What grading looks like in SBG

- **Grade by question** replaces "__ of N points" (`CreditForm`) with five buttons: **0 1 2 3 4**. `applyGroupScore` is called with `s × 25` and keeps the error-type rule (a 4 carries no error type).
- **The per-answer quick buttons** (`giveCredit`, `teacher-review.tsx:1210`) also become 0–4.
- **The grouping** (`questionSummary`) reads "N scored 4 · N scored 1–3 · N scored 0". The same groups are kept, so one tap still scores every student who wrote the same answer.
- **More decisions for the teacher (a cost to raise with Ricky).** The AI still cannot give partial credit, so every wrong ("other") answer group needs a 0–3 decision. In Percentage most of those are a quick "No credit". Asking the AI to *suggest* a 0–4 score would be a prompt change with an accuracy risk. It is listed as a question, not a plan.
- **Writing tests.** Rubric traits whose maximum is already 4 need no change. A trait with another maximum is shown on 0–4 as `round(score / max × 4)` in SBG, marked "converted". The rubric itself is not edited.

### 1.5 Where the mode is stored

The mode is a new field, **`Assessment.gradingMode?: "percentage" | "sbg"`**. A missing value means Percentage, so every existing test is unchanged.

**It needs a database column, so it must go in both functions** (CLAUDE.md, "Workspace persistence"). The workspace is not stored as a blob:
- `sync_workspace` writes each assessment's fields into named columns;
- `get_workspace_json` reads them back;
- a field neither function names is dropped on save.

**The save path needs no schema change.** The `/api/workspace` schema passes assessment fields through (`app/api/workspace/route.ts:66-77`, `.passthrough()`).

**The migration** follows the required patch style (`docs/system-map.md`, rule R2: "Use the patch style of `20261013130000_question_second_choice.sql`"):
- It reads the live function definitions.
- It replaces exact fragments.
- It stops with an error if a fragment is not found exactly once.

The four fragments below each occur once in the current definitions. Those come from the last full rewrite, `20261008190000_points_final_answers_stable_order.sql`: the insert column list and select at `:102-128`, and the read at `:395-405`. No later patch touches them. **They must be re-checked against production's `pg_get_functiondef` before applying.** Below is the file to add (not added in this PR, and never to be applied by the author):

```sql
-- supabase/migrations/2026MMDDHHMMSS_assessment_grading_mode.sql
-- Assessment.gradingMode: 'percentage' (today, and what a missing value means)
-- or 'sbg' (Standards-Based Grading, every question out of 4). Design:
-- docs/design/grading-modes-and-dok-grid.md section 1. NOT applied by the
-- author -- apply by hand before merging.
--
-- CLAUDE.md, "Workspace persistence": this adds the column and teaches BOTH
-- sync_workspace and get_workspace_json about it. Only 'sbg' is stored;
-- anything else (absent, 'percentage', junk) is NULL, which get_workspace_json
-- leaves out -- so no value a save sends can fail it, and a test switched back
-- to Percentage is stored exactly as before this column existed.
--
-- Proof: supabase/checks/grading-mode-round-trip.sql, run by hand AFTER this
-- file; it rolls itself back.

set lock_timeout = '5s';

alter table public.assessments
  add column if not exists grading_mode text
  check (grading_mode is null or grading_mode = 'sbg');

do $patch$
declare
  def text;
  -- [function, fragment, replacement]
  edits text[][] := array[
    array['sync_workspace',
      'rubric, student_order, created_at)',
      'rubric, student_order, grading_mode, created_at)'],
    array['sync_workspace',
      'then a->''studentOrder'' else null end,',
      'then a->''studentOrder'' else null end, case when a->>''gradingMode'' = ''sbg'' then ''sbg'' end,'],
    array['sync_workspace',
      'student_order = excluded.student_order,',
      'student_order = excluded.student_order, grading_mode = excluded.grading_mode,'],
    array['get_workspace_json',
      '''studentOrder'', a.student_order,',
      '''studentOrder'', a.student_order, ''gradingMode'', a.grading_mode,']
  ];
  fn text;
  i int;
  hits int;
begin
  foreach fn in array array['sync_workspace', 'get_workspace_json'] loop
    def := pg_get_functiondef(case fn
      when 'sync_workspace' then 'public.sync_workspace(uuid,jsonb)'::regprocedure
      else 'public.get_workspace_json(uuid)'::regprocedure end);
    for i in 1 .. array_length(edits, 1) loop
      continue when edits[i][1] <> fn;
      if position(edits[i][3] in def) > 0 then
        continue; -- already applied
      end if;
      hits := (length(def) - length(replace(def, edits[i][2], ''))) / length(edits[i][2]);
      if hits <> 1 then
        raise exception 'grading_mode migration: % fragment found % times, expected 1: %', fn, hits, edits[i][2];
      end if;
      def := replace(def, edits[i][2], edits[i][3]);
    end loop;
    execute def;
  end loop;
end
$patch$;
```

**The rest of the build PR:**
- `"gradingMode"` is added to `PERSISTED.Assessment` in `tests/workspace-persistence-guard.test.mjs` (`:46-52`).
- `tests/invariants/workspace-field-round-trip.test.mjs` rebuilds both functions from the migrations, so it checks the fragments with no list edit. `["Assessment", "gradingMode"]` is also added to its newest-patches guard (`:83-97`).
- A rolled-back proof, `supabase/checks/grading-mode-round-trip.sql`, is written in the shape of `second-choice-round-trip.sql`. It saves a test with `gradingMode: "sbg"`, reads it back, then saves it without the field and checks it is cleared. The standing rule is that we do not run test transactions against production ourselves, so **Troy runs it by hand after applying the migration.** The PR will say that the save/reload proof is pending until then.
- No per-answer column is needed, because SBG scores live in the existing `match` (`student_responses.match_score numeric(5,2)`).

### 1.6 Every screen and report that shows a percentage today, and what it shows in SBG

**Built (26 Oct 2026, G2):**
- grading in 0–4: Grade by question's five buttons and the per-answer quick buttons;
- the student's result and per-standard rows;
- one answer's footer;
- Grade by question's counts;
- the class analysis cards and report text;
- the gradebook CSV;
- the Standard Tracker (the student page's progress on one standard), which reads each test in its own mode (Ricky, 20 Oct 2026).

**Still percentages on a Standards-Based test**, so not in that build:
- the DOK grid and its cell panel;
- the class and student depth breakdowns (DOK / Costa);
- the student report text;
- writing tests.

The cross-test screens other than the tracker stay percentages, as proposed below (Question A1).

These are the **per-test** places: they read this test's answers, so they follow the test's mode.

| Where | Code | Percentage (today) | SBG |
|---|---|---|---|
| Student's test score (review screen) | `StudentResponseReview`, `teacher-review.tsx:1629-1640`, from `studentReview` | "90% · 18 / 20 points" | "**3.2** out of 4 · Proficient" (average of 0–4, one decimal) |
| Per-standard rows on that screen | `teacher-review.tsx:1935-1965` | "78% average answer match · 3 of 5 fully correct" | "**3.1** average · 3 of 5 scored 4" |
| Student's depth breakdown | `StudentDepthBreakdown`, `teacher-review.tsx:1064` | "N% correct" per DOK / Costa | "**N.N** average" per DOK / Costa |
| One answer's footer | `teacher-review.tsx:1820` | "75% answer match" | "Score **3** of 4" |
| Grade by question counts / group label | `teacher-review.tsx:591-606`, `:794` | "N part credit", "X of Y points" | "N scored 1–3", "Score 3" |
| Gradebook CSV | `gradebookCsv`, `teacher-workflow.ts:1377` | "Q1 (2 pts)", "Points (of T)", "Score %" | "Q1 (0–4)", "Average (0–4)", "Level" |
| Student report | `studentReport`, `teacher-workflow.ts:849` | "Confirmed assignment score: 90% · 18/20 points", "N% average answer match" | "Confirmed assignment score: 3.2 out of 4 (Proficient)", "3.1 average" |
| Class analysis card | `ClassAnalysisPanel`, `teacher-assessments.tsx:2767`; `classAnalysis`, `lib/teacher-class-analysis.ts:188` | "Class average 78%", level pill, meter, students by level | "Class average **2.9** out of 4", SBG level, meter at `avg / 4`, students by SBG level |
| Class depth breakdown | `CognitiveBreakdown`, `teacher-assessments.tsx:2721` | "N% correct · Q questions" | "**N.N** average · Q questions" |
| Class report text | `classAnalysisReport`, `lib/teacher-class-analysis.ts:250`; `cognitiveReportSection` `:322` | percentages and % ranges | 0–4 averages, SBG ranges ("Beginning 0–1.9") |
| Writing class analysis | `teacher-assessments.tsx:2465-2505`; `writingClassAnalysis` `:142` | "Avg 3.1 / 4" plus a level from the percentage | "Avg 3.1 / 4" plus the **SBG** level |
| Points editor, "Total: N points" | `teacher-assessments.tsx:1209`, `:1275` | editable points | hidden; "Every question is out of 4" |

**Cross-test screens are the open design question.** These read **evidence** (one percentage per standard per test), not a test's answers:
- the standards heatmap (`teacher-insights.tsx:834-910`);
- the student page's "Evidence by standard" and "Progress over time" (`:1373-1450`);
- the student cards ("N/T skills at or above 70% standard score", `:1729`);
- the mastery-levels view and groups (`performanceBands`, `sharedGapGroups`);
- Overall progress (`progressOverTime`);
- `student-mastery.csv`.

A student's standard score there mixes tests that may have been graded in different modes. The proposal for the first build:
- Evidence stays a percentage. An SBG test writes `average / 4 × 100`, which is exactly the mean of its `match` values, so `reconcileEvidence` does not change.
- These screens keep percentage levels.

**The cost:** a student at 2.5 is "Approaching" on the SBG test and "Beginning" (62.5%) on the heatmap. The alternative is a **class-wide** choice of how cross-test screens read: either all percentages or all 0–4. That needs a class setting (another column) and a rule for converting old percentage evidence to 0–4. This is Question A1 for Ricky.

**Unchanged in both modes:**
- alignment ("Standards alignment 90%" is about questions, not students);
- name-match confidence;
- the student card's 70% wording, until Question A1 is answered.

---

## 2. The DOK grid

### 2.1 What it shows

The grid sits on the test's **Class analysis** tab (`ClassAnalysisPanel`). It goes above the per-standard cards and replaces the one-dimensional "Depth of knowledge across this assessment" rows (`CognitiveBreakdown`), which it contains.

**Layout:**
- **Rows:** the standards on the test. A row is the question's *primary* `standard`, the same rule `classAnalysis` uses, so the grid and the cards beside it never disagree.
- **Columns:** DOK 1, DOK 2, DOK 3, DOK 4.
- **Each cell shows:**
  - the class's score in the test's mode ("72%" or "2.6");
  - the cell coloured by level (red / yellow / blue / green, `levelClass`);
  - the level's recommendation in small type ("Reteach Recommended", "Monitor", "Ready to Move On", "Extension Recommended"; the `advice` from #166);
  - a small question count ("3 questions").
- **Legend:** a small legend under the grid, built from `MASTERY_LEVELS` like the heatmap's (`teacher-insights.tsx:840-846`). In SBG it shows the 0–4 ranges.

### 2.2 Where each number comes from

Everything is already on the client, in `a.questions` and `a.responses`. **No new data or column is needed:**
- `Question.dok` is stored (`assessment_questions.dok`, read back by `get_workspace_json`);
- `Question.standard` is stored;
- `StudentResponse.questionId` joins an answer to its question.

**Cell (standard S, DOK d):**
1. **Questions:** the active (`!excluded`) questions whose `standard` is S and whose `dok` is d.
2. **Answers:** the **verified** answers to those questions. This is the same rule as `classAnalysis` and `levelBreakdown` (`lib/teacher-metrics.ts:61`), so no unconfirmed AI guess is counted.
3. **Each student's score in the cell:** the mean of their answers' `responseMatch` (Percentage), or the mean of `match / 25` (SBG).
4. **The cell's score:** the mean of the students' scores, the same student-first averaging as the class card's "Class average".
5. **Level and colour:** from that number, by the test's mode.

The result is a new pure function in `lib/teacher-class-analysis.ts`, `dokGrid(a, students, catalog)`, with unit tests. It is the 2-D version of `dokBreakdown` (`lib/teacher-metrics.ts:95`), which today only splits by DOK.

### 2.3 Cells with no questions, and other gaps

- **No questions at that standard and DOK.** The cell is grey and says "Not Tested" (Ricky, 26 Oct 2026; it said "No questions" before). Tapping it opens a short panel explaining that no question on this test was at that DOK level for that standard. This will be the most common cell: a 10-question test rarely covers 16 combinations. Columns stay fixed at 1–4 so the grid always reads the same way.
- **Questions but no graded answers yet.** The cell is grey with "Not graded yet". In practice the Class analysis tab only opens once every answer is decided (`ConfirmMatchesFirst` / `DecideFirst`, `teacher-assessments.tsx:1512-1531`), so this is rare.
- **A question with no DOK.** The AI always sets 1–4 (`analyze-shared.ts:300`, checked at `:800`), but the column is nullable. Today `dokBreakdown` counts such a question as DOK 1, while the Standards report leaves it out. The grid will **leave it out** and say so under the grid: "1 question has no DOK -- set it in Assessment review". It will not guess.
- **One question in a cell.** That score is one question's result. The question count is always shown, and a cell with one question is marked "1 question". Whether to also soften the recommendation there is Question B3.

### 2.4 Clicking a cell

Clicking a cell opens a panel: a `Sheet` from the side on a computer, or from the bottom on a phone. It contains:

1. **The heading:** "4.OA.A.3 · DOK 2 · 58% · Reteach Recommended", then the questions in the cell (Q3, Q7) with links.
2. **The common errors** for those questions. They come from the error types we already store per answer:
   - `StudentResponse.errorType`, confirmed by the teacher in Grade by question;
   - counted with `tallyErrorTypes` (`lib/teacher-class-analysis.ts:59`), limited to the cell's questions;
   - shown with `ErrorTypeList` (`teacher-assessments.tsx:2686`): "Sign error (5)" and the students' avatars.

   No grouping of errors is saved, and none is needed: the tally is worked out from the per-answer tags, as the per-standard card does today.

   **The gap:** error types exist for **Math only**. The ELA list is empty on purpose (`lib/error-types.ts:23`), and the free-text `misconception` is now almost always empty, because grading no longer asks the AI for it (`analyze-shared.ts:505`). So an ELA cell has no common errors to show. For ELA the panel will instead show the most common wrong answers, from `groupAnswers` (`lib/teacher-workflow.ts:1084`), on screen only. Those are student answers, so they are **not** sent to the AI (see 2.6). Question B4 asks whether Ricky wants an ELA error list.
3. **The next-step button** for the cell's level, using the existing `nextStep` intents:

   | Cell level | Button | Intent |
   |---|---|---|
   | Beginning | "Reteach DOK 2" | reteach |
   | Approaching | "Targeted practice DOK 2" | practice |
   | Proficient | "Optional reinforcement DOK 2" | reinforcement |
   | Exceeding | "Extension DOK 2" | extension (aimed at DOK 3, see below) |

   The button opens the existing lesson generator: `/lessons?standard=…&assessment=…&students=…&intent=…&dok=2`.
   - `students` is the students whose cell score is in that level.
   - `ReteachView` (`components/teacher-planning.tsx:212`) gains a `dok` parameter.
   - On that page the teacher sees "**DOK levels:** [x] 2  [ ] 1  [ ] 3  [ ] 4" and can **add other DOK levels to the same lesson**.
   - The common errors from the cell are listed as "Aimed at: Sign error (5), Wrong formula (2)", with a remove (×) on each.
4. **For an Exceeding cell**, an extension is naturally pitched *one level up*, so the button pre-ticks DOK d+1 (capped at 4). Question B5 asks Ricky to confirm.

### 2.5 The per-student version

**The data supports a per-student version:** each answer joins to its question's standard and DOK. It will appear on the student's review screen (`StudentResponseReview`), next to the existing `StudentDepthBreakdown`, which it replaces in the same way.
- The cells use only that student's answers.
- In the large majority of cells that is **one answer**, so the cell shows the answer's own result ("✓" / "✗" / "Score 3") with its colour, rather than an average that looks more certain than it is.
- Clicking a cell opens the same panel, with that student's answer, its error type, and the same next-step buttons for that one student (`students=<id>`).

### 2.6 What the AI lesson prompt needs to change

**Today** (`buildPrompt`, lesson branch, `lib/analyze-shared.ts:716-747`):
- **Inputs:** the standard (the whole catalog entry, including its generic `misconception` and its catalog `dok`), duration, modality, `intent`, and the teacher's notes as data.
- **The `aim` text** varies by intent (`:727-734`).
- **The output** already has practice problems and an exit ticket (`lessonSchema`, `:431-437`). "A lesson plus practice and exit ticket" needs no new output shape.
- **There is no DOK level and no error type in the prompt.** "higher-DOK" in the extension aim is the only mention.

**Changes:**

1. **`analyzeInput`** gains two optional fields:
   - `dok: z.array(z.number().int().min(1).max(4)).max(4)`;
   - `errorTypes: z.array(z.object({ name: z.string(), count: z.number().int() })).max(10)`, where every `name` must be in `errorTypesFor(subject)` (`lib/error-types.ts:30`) or it is dropped. Free text never gets in this way.
2. **The prompt states what each DOK level means.** It has no definitions today (the assignment prompt only says "Classify Webb DOK 1–4"). One sentence per level: DOK 1 recall and reproduction; DOK 2 skills and concepts; DOK 3 strategic thinking and reasoning; DOK 4 extended thinking.
3. **New `aim` text** when `dok` is given: "Pitch the guided practice, the five practice problems and the exit questions at Webb DOK 2 (…). Label each practice problem with its DOK level." When several levels are ticked: "…spread across DOK 1 and 2, easiest first."
4. **New `aim` text** when `errorTypes` is given: "The most common mistakes in this group were: Sign error (5 students), Wrong formula (2). Address these specifically in the modelling and the practice." Only the type names and counts are sent.
5. **The output gains** an optional `dok` on each `practice` and `exit` item, so the lesson can show "DOK 2" beside each problem. Lessons are stored whole in `lessons.body` (jsonb), so this needs no migration (`tests/workspace-persistence-guard.test.mjs:13`).
6. **`READ_PROMPT_VERSION` does not change.** Lessons are not in `REUSABLE_READ_MODES` (assignment, passage, roster and answer_key only), so there is no cache to invalidate.

**Student-data check** (CLAUDE.md: re-read `docs/student-data-flow.md` §4 before any prompt change):
- §4 does not mention the lesson mode today (`docs/student-data-flow.md:153-175`), so the build PR adds a lesson entry.
- What it would add reaching the AI is **DOK numbers, and error-type names from a fixed list with counts**. Neither carries a student's identity.
- **Not sent:** student names, student ids, the students' answers, or wrong-answer text. The ELA "most common wrong answers" in 2.4 stay on screen.
- **Existing risk, not new:** the lesson page already pre-fills the teacher's notes from the `misconception` text of the chosen students' answers (`teacher-planning.tsx:271-295`), and a teacher can type a name into those notes. The build PR will note this risk in §4, not widen it.
- Per CLAUDE.md, changing what reaches the AI means updating §4, its "last verified" date and `content/legal/` together, in the same PR.

### 2.7 On a phone

At 390px a five-column table (standard plus four DOK columns) leaves about 65px per cell. That is not enough for "72%" plus a recommendation, and the heatmap's sideways scroll (`components/ui/table.tsx:10`) is the pattern Michael found hard to use. So on a phone (below 700px, the same breakpoint as `.skill-gap-groups`):

- **Each standard becomes a small card.** The code and short title sit on top. Below them, **one row of four cells**: DOK 1–4, about 80px each.
- **Each cell shows only the score and the colour.** The recommendation is in the cell's accessible label and in the panel when tapped.
- **The legend wraps under the cards.**
- **Tapping a cell opens the panel from the bottom** (`Sheet side="bottom"`).
- **No sideways scroll.** The browser check will cover 390x844 and 412x915 as well as computer sizes.

---

## 3. Questions for Ricky, and an estimate

### 3.1 Questions, in plain words

**Grading modes**

- **A1.** When a test is graded 0–4, should the **heatmap and student pages** (which mix many tests) also show 0–4? Or should they stay in percentages? If they stay in percentages, a student can be "Approaching" on the 0–4 test and "Beginning" on the heatmap for the same work, because the cut-offs are different. If they switch, we need one setting for the whole class, and we would convert older percentage tests to 0–4.
- **A2.** The AI can only say right, blank or "other". On a 0–4 test, every "other" answer will need you to pick 0, 1, 2 or 3 (answers grouped, so one tap per group). Is that fine? Or would you like the AI to *suggest* a score for you to confirm? Suggesting a score is new and we would need to test how often it is right.
- **A3.** A test already graded with points (say 2 of 3 points) shows as the nearest whole score (3) when switched to 0–4, marked "converted -- check", until you confirm it. Is "nearest whole score" the right conversion?
- **A4.** Should the mode be chosen when the test is set up, switchable later, or both? Should a new test start in the mode you used last?
- **A5.** On a 0–4 test, should a student's result show one decimal ("3.2") or be rounded to a whole number?

**DOK grid**

- **B1.** On a phone, is "one small card per standard with four DOK boxes" OK, with the recommendation shown only when you tap a box?
- **B2.** For empty boxes (no questions at that DOK), is a grey "No questions" right, or would you rather the empty DOK columns were hidden? *Answered (Ricky, 26 Oct 2026): keep the columns; the box says "Not Tested" and tapping it explains why.*
- **B3.** When a box has only one question behind it, should it still say "Reteach Recommended", or something softer like "Only 1 question -- check"?
- **B4.** ELA has no list of error types yet, so ELA boxes can't show "common errors" the way math does. Would you like to give us an ELA list (like the five math ones)? Until then we would show the most common wrong answers.
- **B5.** "Extension" on a DOK 2 box: should the lesson aim one level higher (DOK 3), or stay at DOK 2 and go deeper?
- **B6.** Should the per-student grid show each box as right / wrong (one question), or a score?

### 3.2 Estimate

Each item is one PR, with the "This is proven when" first and a test that fails on main.

**Grading modes: 3 PRs, plus 1 if A1 is "switch the cross-test screens too".**

| # | PR | Notes |
|---|---|---|
| G1 | The mode itself | `gradingMode` field, the migration in 1.5, the persistence-guard and round-trip tests, the rolled-back check file, and the switch on the test. Scores unchanged. |
| G2 | Grading in 0–4 | Score and level functions that know the mode (SBG cuts in `lib/mastery-levels.ts` beside the percentage ones), 0–4 buttons in Grade by question and per answer, the "converted" marking. |
| G3 | Every per-test screen and report in 0–4 | Everything in the 1.6 table, including CSV and printed reports. Browser check at phone and computer sizes. |
| (G4) | Cross-test screens in 0–4 | Only if Ricky says yes to A1: a class setting (another column, same migration pattern) and converting percentage evidence. |

**DOK grid: 4 PRs.**

| # | PR | Notes |
|---|---|---|
| D1 | The class grid | `dokGrid()` with unit tests, the grid on Class analysis replacing the DOK rows, empty and no-DOK cells, legend, phone cards. Browser check at 390 / 412 / computer. |
| D2 | Cell panel | Common errors (math), most common wrong answers (ELA), the next-step button opening the lesson page with `dok` and `students`. |
| D3 | DOK-aware lessons | `analyzeInput` `dok` and `errorTypes`, prompt definitions and aim text, DOK on each practice item, the "add other DOK levels" ticks, and the §4 entry plus `content/legal/` update in the same PR. |
| D4 | Per-student grid | On the student's review screen. |

**Order.** D1–D4 work in Percentage mode alone, so the grid can ship before grading modes. G2 has to land before the grid can show 0–4: D1 reads the score and level through G2's mode-aware functions, so whichever ships second wires them together.

**Total: 7 PRs, or 8 with G4.**
