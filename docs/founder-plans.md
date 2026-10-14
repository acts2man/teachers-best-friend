# Plans for founder approval: 12 Oct 2026

**Nothing in this document is built.** It sets out four plans, plus three smaller
decisions, for Ricky and Michael to approve, change or turn down before any code
is written. Each plan gives:

- what it needs from the data;
- the screens it would add or change;
- what the AI would cost per class set;
- what could go wrong;
- what we still need from you.

### Labels used here

Every claim carries one of these tags:

- **[VERIFIED]**: checked today against the live database or the code. The
  query or file is named.
- **[REPORTED]**: one of you, or Troy, told us. We have not been able to check
  it.
- **[INFERRED]**: our best explanation. It is not proven yet.

Update, 14 Oct 2026: section 3 now folds in Ricky's 13 Oct class analysis spec
(mastery bands, the standards × DOK grid, the standards tracker and a
tested-only standards report). It is still a plan: nothing in it is built.

Status as of 13 Oct 2026. #123 and #124 are **live**: merged and deployed
[REPORTED by Troy, 13 Oct]. #125 and #126 are **built, not yet live**: open and
waiting for review. Nothing in an open pull request is on the app you use, and
each mention below says which state it is in. The standards fix in plan 1 is now
**built, not yet live**, as #129. That was done without waiting for your
approval, because it is a bug fix, not a feature.

### Costs

Costs are what real requests cost, from the `scans` table over the last 30 days
(`cost_usd`, averaged per request type), at today's `pipeline_config` settings.
Test reads and key checks run on the `gpt-5.6-luna` model. Its price, from the
`model_pricing` table, is $0.20 per million input tokens and $1.20 per million
output tokens.

A cost we haven't measured is labelled **estimated**, with the arithmetic
shown. This document changes no AI settings.

A "class set" means one test for a class of 26 students, 1 to 2 pages each.

---

## 1. Standards accuracy

### What was asked
[REPORTED] Troy asked for three things:
- take Ricky's five most recent tests and compare the app's standard with his
  own;
- explain why the app misses;
- explain why scanning the same test twice gives different alignment
  numbers. Michael saw 78%, then 75%.

### What we found

**Where the numbers come from.**
- **What the app suggested:** the `scans.result` row for each test read. These
  rows are kept for 48 hours. A row records the read *after* the app's own
  clean-up, described under "Why it goes empty" below. So an empty standard
  there means "nothing usable survived", not necessarily "the AI wrote
  nothing".
- **What Ricky kept:** `assessment_questions.standard_code`.

| Test (topic only) | Questions | App suggested a standard | Ricky's saved standard |
|---|---|---|---|
| Algebra 2: exponential/log, read today | 10 | **0 of 10** (two reads, both empty) | 10 set by hand |
| Algebra 2: rational expressions | 15 | 15 of 15 | kept all 15 suggestions |
| Grade 7: percents (2nd test) | 10 | 10 of 10 | kept all 10 suggestions |
| Grade 7: percents | 10 | **0 of 10** | 10 set by hand |
| Algebra 2: exponential/log 2 | 10 | **0 of 10** (two reads, both empty) | 10 set by hand |

[VERIFIED by SQL against `scans` and `assessment_questions`]

What this tells us:
- **[VERIFIED] On 3 of the 5 tests the app suggested no standard for any
  question.** Ricky tagged all 30 of those questions himself. They carry an
  alignment of 0 and no AI score, which is what the "assign a standard to
  questions 1–10" tool leaves behind. A question typed in by hand would look
  the same, so the tool is likely but not proven.
- **[VERIFIED] On the other 2 tests, Ricky kept all 25 suggestions.** The saved
  alignment equals the AI's figure exactly, so these are the AI's tags,
  confirmed in bulk.
- **[INFERRED] The 25 he kept are not proof that the app picks well.** Keeping a
  suggestion, especially with "Looks good — confirm all", isn't the same as
  choosing it independently. We can't yet tell how often the app's pick is
  *wrong*, only how often it is *missing*. The question for Ricky at the end of
  this plan is how we find out.
- **[VERIFIED] The missing standards are not just Ricky's.** Across every test
  read in the last 48 hours (9 reads, 100 questions, both of you), **75 of 100
  questions came back with no standard**. These are the only reads still on
  file; older ones are deleted after 48 hours by design. Michael's one
  remaining read is 15 of 15 empty.

### Why it goes empty
The AI is choosing a standard. The app is then throwing it away.

- **[VERIFIED in `scans.result`]** On the empty questions, the AI's written
  reasoning names a code, for example "F-IF.7 is the closest catalog standard".
  Its *second-choice* standard field still holds real codes (F-IF.7, F-BF.1,
  7.RP.3), and **those codes are in Ricky's standards list** (checked in the
  `standards` table).
- **[VERIFIED in code]** `lib/analyze-shared.ts` line 773 keeps the AI's first
  choice only if it matches a code in your list **character for character**. If
  it doesn't, the app:
  - blanks the standard;
  - sets its alignment and confidence to 0;
  - logs nothing and keeps no copy of what the AI wrote.
  The second choice gets the same exact check, which is why it can survive when
  the first doesn't.
- **[INFERRED]** The AI writes its first choice in a form that is close to the
  code in your list but not the same. The likely candidates:
  - The official long forms, such as `7.RP.A.3` or `HSF-IF.C.7`. The list we
    give the AI shows each standard's cluster letter in its own field next to
    the code (`lib/prompt-payload.ts`), which makes `7.RP.A.3` an easy slip.
  - Sub-parts, such as `F-IF.7e` (California's sub-part for graphing
    exponentials, which fits both exponential tests).
  - Sub-parts written without the dot. Your grade 7 list writes them as
    `7.RP.2.a`.

  We can't see the exact text, because the code that blanks it doesn't keep it.
  Step 1 below fixes that first, so we stop guessing.

### Why repeat scans differ (78% then 75%)
- **[REPORTED]** We can't check Michael's two reads, because both were deleted
  after 48 hours.
- **[VERIFIED in code]** The alignment percentage is an average of one AI score
  per question (`alignment()` in `lib/teacher-data.ts`). Three things move it
  between reads:
  - **[INFERRED]** The AI's score for the same question varies a little from
    one read to the next. We haven't measured by how much.
  - **[VERIFIED in code]** A question whose standard was blanked drops out of
    the average entirely. A re-read that blanks one more question, or one
    fewer, moves the number.
  - **[VERIFIED in code]** A question tagged with a standard that isn't one of
    your *intended* standards counts as 0. A re-read that moves one question
    onto or off your intended list moves the number.
- **[VERIFIED in code] Re-reading doesn't help on the broken tests.**
  - The app reuses an earlier read of an identical test, but **not** when any
    question came back without a standard. That is exactly the 75%-empty case.
  - It also never reuses when you press "Read again", or once 48 hours have
    passed.
  - So the tests with empty standards are read fresh every time, and drift.
  - Live since 13 Oct: PR 1 (#124) makes a change to the AI settings
    count as a different test for reuse. Before it went live, a read made
    before a settings change could be reused after it.

### Proposed fix (in this order)
*Steps 1, 2, 3 and 5 are built, not yet live, in #129. One part of step 3 is
not built: an unconfirmed fallback still counts toward the alignment average, at
its capped 60%. Step 4 is not built. #129 lists what its replay could and could
not show. It counted 85 of 138 empty, a later and wider 48-hour window than the
75 of 100 above.*

1. **Keep what the AI actually wrote.** Store the AI's raw first-choice code
   next to the result, server side only. It would sit in the same `scans.result`
   row that already holds everything else, and be deleted with it after 48
   hours. AI cost: none. One day of real use then shows the exact form being
   rejected.
2. **Accept close forms of a code in your list.** Only for a code that isn't an
   exact match, and only when this produces **exactly one** code that *is* in
   your list:
   - ignore case and spaces;
   - drop a leading `CCSS.MATH.CONTENT.` or `HS`;
   - drop a cluster letter, meaning only a single letter A–D in the
     third-from-last position (`7.RP.A.3` becomes `7.RP.3`). This never touches
     the grade letter in `RL.K.1`;
   - match a sub-part with or without its dot (`7.RP.2a` becomes `7.RP.2.a`);
   - roll a sub-part up to its parent (`F-IF.7e` becomes `F-IF.7`), but only
     when the sub-part itself isn't in your list.

   A code for another grade is never accepted: `6.RP.A.3` stays refused in a
   grade 7 list.
3. **Fall back to the AI's second choice** when the first still doesn't match
   and the second does. A fallback is always marked "check this". It never
   shows as a strong (green) match, and it doesn't count toward the alignment
   average until you confirm it.
4. **Make the AI pick from the list.** The full list is already in the request,
   and the instructions already say to use only those standards. The change is
   to the *answer format*: the AI could then only return a code from the list,
   or nothing. This is the strongest fix, so it goes in only with step 6's
   evidence.

   It adds **estimated** about 330 tokens per read: 54 codes in Ricky's Algebra
   2 list × about 6 tokens each. That is about $0.0001 per test read.
5. **Never blank a choice silently.** If nothing matches, the question shows
   "The AI suggested *X*, which isn't in your standards list", and you pick.
6. **Measure it.** See below.

### Measuring the before and after
PR 1 (#124, live) adds a regression replay with a `standards`
case type. That case type scores the share of questions where the app's
standard equals the teacher's saved one.

**Before we score anything against Ricky's tags, we need his answer to the
first question at the end of this plan.** Thirty of the questions on those
five tests were tagged by him only because the app gave nothing. If some of
those are fallbacks rather than his real choice, they aren't a fair answer key.

**This is proven when** all of the following hold:

- **Coverage.** Replaying Ricky's five tests, and at least three tests not used
  to build the fix, gives a standard on at least 95 of every 100 questions.
  - The three extra tests include one of Michael's K-6 or ELA tests.
  - The replay runs twice; the AI varies, so one run proves little.
  - Today the figure is 25 of 55 on Ricky's five tests, and 25 of 100 across
    everything on file.
- **Agreement.** On the questions Ricky confirms as his real choice, the app's
  standard is the same as his on at least 90%.
- **Unit test, with a stated sample list.**
  - Accepted: `7.RP.A.3` becomes `7.RP.3`; `7.RP.2a` becomes `7.RP.2.a`;
    ` f-if.7 ` becomes `F-IF.7`.
  - `F-IF.7e` becomes `F-IF.7` when `F-IF.7e` isn't in the list, and stays
    `F-IF.7e` when it is.
  - `RL.K.1` is unchanged in a kindergarten ELA list.
  - Refused in a grade 7 list: `6.RP.A.3` and `8.EE.1`.

### Data needed
- Already stored: the questions, your standards list, and the standards you
  saved.
- New: the raw AI code, kept for 48 hours only. No workspace field changes for
  steps 1–5.
- **One gap.** [VERIFIED in code] When you change a single question's standard
  by hand, the AI's alignment score stays on the question
  (`verifyQuestion`, `components/teacher-assessments.tsx`). That causes two
  problems:
  - afterwards we can't tell your pick from the AI's;
  - the alignment average uses a score the AI gave for a *different*
    standard.

  Fixing that needs a new `standardSource` field ("AI" or "teacher"). Under the
  rule in `CLAUDE.md`, that is a database migration that changes both save
  functions, and it has to be proven by saving and reloading.

### Screens
- The "Check what each question measures" list gains one line per unmatched
  question: "The AI suggested *X*, which isn't in your list".
- A second-choice fallback shows as "check this".
- The alignment figure says how many questions have no AI score behind it.

### AI cost per class set
- Steps 1–3, 5 and 6: **$0 extra**. The replay itself costs about $0.005 per
  test read.
- Step 4: **estimated** about $0.0001 extra per test read, as worked out above.
- A test read today: **$0.0054** on average [VERIFIED: 9 reads with
  `params.mode = 'assignment'` in `scans`].

### Risks
- **Rolling a sub-part up to its parent** could turn a precise tag into a
  broader one. It's only done when the precise code isn't in your list, so
  nothing better is lost.
- **Falling back to the second choice** fills in a guess. Two consequences:
  - A coverage target rewards filling in. That is why a fallback stays "check
    this" and out of the average.
  - A read with no empty questions becomes reusable, so a fallback guess would
    be reused on the next read of the same test until you correct it.
- **Step 4 changes the AI request.** The `docs/student-data-flow.md` section 4
  check applies, though no student data is involved.

### What we need from you
- **Ricky:** on the two exponential/log tests, is F-LE.4 the standard you
  wanted on every question, or did you use it because the app gave you nothing?
  The AI's reasoning pointed at F-IF.7 (graphing) and F-BF.3 (transformations)
  for some of them.
- **Ricky:** on the two tests where you kept every suggestion, were they right,
  or did you confirm them to get moving? This tells us whether the app picks
  *wrong* as well as *nothing*.
- **Both:** should a question the AI can't place be left empty for you to
  choose (today's behaviour, made visible), or filled with its second choice
  and marked "check this"?

---

## 2. Glow and grow feedback

### What was asked
[REPORTED] For each student, one thing they did well (glow) and one thing to
work on (grow), to hand back with the test.

### Data needed
All of this is already saved [VERIFIED in `lib/teacher-types.ts` and the
persistence guard]:
- per student, each answer with its credit and whether you confirmed it;
- the standard of each question;
- the error type you tagged;
- class mastery per standard.

Nothing new needs storing unless you edit the wording (see Risks).

### Two ways to do it

**A. Written by the app from your grading, with no AI.**
- Glow: the student's strongest standard, or a question most of the class
  missed that they got right.
- Grow: their weakest standard, plus the error type you tagged most often on
  their answers.

Every sentence comes from your confirmed grades, so it can't say something you
didn't mark. AI cost: **$0**.

**B. Written by the AI from the same facts.** This produces warmer, more varied
wording. There would be one request per class set, never one per student. The
request carries:
- each student as a number only (no name);
- per question: the standard, right or wrong, and the error type.

[INFERRED] This sends no names, but each student's right/wrong and error types
are a new kind of data sent to the AI. They aren't on the "what is
transmitted" list in `docs/student-data-flow.md` section 4. That section and
the four published legal pages must be updated **before** B ships.

AI cost, **estimated**:
- input: 26 students × 10 questions ≈ 4,000 tokens, plus 1,000 of
  instructions, at $0.20 per million: $0.001;
- output: about 3,000 tokens, at $1.20 per million: $0.0036. Any AI "thinking"
  is billed as output, so this rises if more effort is set;
- **total about $0.005 per class set.**

**We recommend A first.** It costs nothing, can't invent anything, and shows
whether you actually use the slips. B can be added on top if the wording feels
flat.

### Screens
- A "Glow & grow" panel next to Class analysis: one card per student, each
  editable before printing.
- A print view with one slip per student, several to a page, to cut and hand
  back.

### Risks
- **A slip built before grading is finished.** These go to children, so no slip
  is built until **every** answer on the test is confirmed by you. That means
  every answer, not just the ones matching the key. Today's Class analysis
  screen opens while answers are still being graded, so this needs its own
  check.
- **B only: the AI writes praise or a claim your grades don't support.** Each
  sentence would be checked against the student's actual results before it is
  shown, and you see every slip before printing.
- **B only: a numbering mix-up gives a child someone else's slip.** The app
  would match numbers back to students itself and refuse a reply whose numbers
  don't line up.
- **Wording for young readers.** For K-2, an error-type label like "sign error"
  isn't a sentence a child can read. Michael, we'd need your wording.
- **Edits that survive a reload.** If edits must survive, the edited text is a
  new saved field and needs a migration plus a save-and-reload proof.

### What we need from you
- **Michael:** two or three glow and grow sentences you'd actually write for
  K-2 and for grades 4–6, so the wording fits the age.
- **Both:** A, B, or A now and B later?

---

## 3. Class analysis per standard and per student, plus a printable report

### What exists today [VERIFIED in `components/teacher-assessments.tsx`]
- The Class analysis tab, per standard: percent mastered, who is strong, who
  needs help, whole-class or small-group, and the error types.
- "Print" and "Download report". These print **plain text** (`printContent`
  in `components/teacher-shared.tsx`), not a table.

### What's missing
- A **per-student** view: each student's score, points, and how they did on
  each standard of this test.
- A printout that looks like a report, not a text file.

### Ricky's example
Ricky's example row, with a made-up name: "Miles Morales 88% 14/16 27/40".

[INFERRED] 14 out of 16 is 87.5%, which rounds to 88%. So 88% is very likely
"questions right out of questions". **We don't know what 27/40 is.** Points?
Another test? We need Ricky to tell us.

### Data needed
- All already saved [VERIFIED, persistence guard]: confirmed answers, points
  per question, the test's points total, and the standards.
- No new fields.

### Screens
- Class analysis gets a "By student" table:
  - columns: name, overall %, points, then one column per standard;
  - sortable;
  - on a phone it becomes one card per student.
- "Print class report": a real printed page, with the per-standard summary on
  top and the by-student table below, on one or two sheets.
- "Print student reports": one page per student, with their row, their
  per-standard results and (if plan 2 is approved) their glow and grow.

### AI cost per class set
**$0.** Everything comes from grades already saved.

### Risks
- **Partial grading read as final.** [VERIFIED] The screen already says "still
  grading N answers" while any are unconfirmed. The printed report must say it
  too.
- **Points versus percent.** [VERIFIED in code, `questionPoints`] A question
  with no points set gets an even share of what is left of the test's total, or
  1 point if there is no total. The report must use the same rule, or numbers
  will disagree between screens.
- **Printing on iPhone.** [INFERRED] Today's Print uses a hidden frame, which
  iPhone Safari is known to handle poorly. Ricky's phone has to be tested by
  hand.
- **Names in a formatted printout.** [INFERRED] A formatted (HTML) printout
  must treat student names as plain text. Today's version is safe only because
  it prints plain text.
- **Privacy.** A printout with every student's score on one sheet is for you
  only. The per-student pages are the ones to hand out.

### What we need from you
- **Ricky:** what is 27/40 in your example?
- **Both:** which columns, in what order?

### Ricky's spec of 13 Oct, folded in (plan only; nothing below is built)

Ricky posted this in #app-ideas on 13 Oct, between 4:15 and 6:10 pm PT, with two
mockups made from sample data [REPORTED, read from Slack 14 Oct]. In his words,
shortened:

- **Mastery bands.** 90–100% Exceeding ("we recommend an extension lesson");
  80–89% Proficient (no recommendation); 70–79% Approaching (no recommendation);
  69% or below Developing ("we recommend support … and reteach lessons"). He
  restated these at 6:10 pm, so they replace the 80 / 60–79 / under-60 colours
  in his earlier grid mockup.
- **A standards × DOK grid.** One row per standard, one column per DOK level,
  each cell the class score, coloured by band; "when you hover over the boxes,
  you get most common errors". His mockup also outlines one cell per row as the
  standard's *required* DOK, and judges the standard there "so the overall
  average can't hide a gap".
- **A per-student "standards tracker".** Not just a score per standard, but how
  it changed each time that standard was tested again. His mockup shows each
  attempt as a bar, with its date, test, item count, DOK and main error.
- **A standards report showing only tested standards.** Tap a standard to see
  the students tested on it, and each of their attempts.

#### What the app has today

Some of this already exists, and the plan builds on it rather than starting
over:

- **The reteach recommendation already exists.** [VERIFIED
  `components/teacher-assessments.tsx`, class analysis] Each standard lists the
  students under 70% as needing reteaching, with "Reteach this group" or
  "Reteach whole class" buttons that open the lesson planner for that standard.
  It also lists the error types per standard, with the students. Under 70% is
  exactly Ricky's Developing band. **What is new** is splitting today's "70% and
  up" group into Approaching, Proficient and Exceeding, and recommending an
  extension lesson for Exceeding.
- **A per-student progress view already exists.** [VERIFIED
  `components/teacher-insights.tsx`, "Progress over time" on a student's page]
  Pick a standard and it shows each result as a bar, with the date, the test's
  name and the score. **What is new** for the tracker: only standards the
  student was tested on, the band on each bar, the change between attempts,
  and the main error.
- **A per-test DOK breakdown already exists.** [VERIFIED `CognitiveBreakdown` /
  `dokBreakdown`] It shows the percent correct at each DOK level, for the class
  or one student. The grid splits that by standard.
- **Three different cut-offs today, none of them Ricky's.**
  - [VERIFIED `lib/teacher-class-analysis.ts`, `MASTERY_THRESHOLD = 70`] Class
    analysis counts a student as "strong" on a standard at 70%+. Writing rubric
    traits use the same 70.
  - [VERIFIED `lib/teacher-data.ts` `masteryStatus`] The Insights map says
    "Mastered" at 80%+, "Developing" at 65–79%, "Needs support" below that. It
    averages a student's last three results on the standard, and shows
    "Building evidence" until there are three. Note that its "Developing"
    (65–79%) is not Ricky's Developing (69% or below).
  - [VERIFIED `components/teacher-assessments.tsx`] In class analysis, the bar
    for "% of students who mastered this" is green at 80%+ and orange under 65%.
    That is a share of students, not a student's score.
- **Results per standard per test are saved, but their dates are not
  reliable.** [VERIFIED `reconcileEvidence` in `lib/teacher-data.ts`] Confirming
  grading gives every student one record per standard per test. But each record
  is stamped with *today's* date, and is rewritten every time the test is saved
  for any reason (even ticking a standard). Touching an old test moves its
  results to "today": they jump to the end of a tracker and change which
  results count as Insights' "last three". **This must be fixed before a
  tracker is trustworthy** (date each result from the test, not the save). No
  new saved field is needed for that.
- **Almost no test results yet, and no retests.** [VERIFIED, read-only query on
  production, 14 Oct] 1,451 standard records are on file. Only 107 of them come
  from a graded test, and those come from 2 tests; none is a second attempt at
  the same standard. The other 1,344 are not tied to a test [INFERRED: the
  app's sample data and records added by hand]. A tracker built today would
  show one bar per standard.
- **Each question has a DOK, read by the AI.** [VERIFIED, read-only query on
  production, `assessment_questions`] Of 126 questions on file, 52 are DOK 1
  and 74 are DOK 2. **None is DOK 3 or 4**, so those grid columns would be
  empty for every test so far. The teacher can change a question's DOK when
  reviewing it.
- **There is no real "required DOK" per standard.** [VERIFIED by counting the
  catalog in `lib/teacher-catalog.ts`] 682 of the 683 California standards
  carry the default DOK 2. The state's files don't give one; the one exception
  comes from the app's own notes on that standard. The outlined "required" cell
  in Ricky's mockup has no data behind it yet.
- **Error types are rare.** [VERIFIED, read-only query on production,
  `student_responses`] 24 of 316 graded answers carry an error type, so "most
  common errors" would be blank in most cells today.
- **Both "standards report" screens list every standard, tested or not.**
  [VERIFIED] The test's "Standards report" tab lists the whole grade catalog
  with a checkbox each, to pick the intended standards. The class "Standards
  heatmap" in Insights has one column per catalog standard.

#### Screens (proposed; none of this exists yet)

1. **One mastery rule with Ricky's four bands.** One function would turn a
   student's percentage on a standard into Exceeding, Proficient, Approaching
   or Developing. It would apply wherever a *student's score on a standard* is
   shown: class analysis, the Insights map, the student page, the tracker and
   the printed report. It would not apply to the "% of students" bar or to the
   scan-matching confidence, which measure other things. Scores would be
   rounded to a whole percent first, so 79.6% would be 80% (Proficient) and no
   score would fall between bands.
2. **Class analysis per test, by band.** Each standard would show how many
   students are in each band, and list them. Developing would keep today's
   reteach buttons. Exceeding would get "Recommended: an extension lesson",
   with a button that opens the lesson planner for that standard.
3. **The test's standards report, tested standards only.** Untested standards
   would leave this view; picking intended standards would stay, as its own
   step. Tapping a standard would show the students tested on it, each with
   their band and every attempt so far.
4. **The student standards tracker.** The existing "Progress over time" panel
   would become one row per standard the student was tested on. Each attempt
   would be a bar: date, test, score, band, and the most common error type
   where one was recorded. A change line ("+28 points, Approaching →
   Proficient") would appear once there are two attempts. Item count, DOK and
   error would be looked up from the test itself, so they would disappear if
   that test is deleted. The score and date would stay.
5. **The standards × DOK grid, per test.** One row per tested standard, one
   column per DOK level the test has, each cell the class score coloured by
   band. **Tapping** a cell (see below) would show its most common errors and
   which students are in it.

#### Data needed

- Screens 1–5 need **no new saved fields**. [VERIFIED] Scores, standards, error
  types and question DOKs are already saved and reloaded (the persistence guard
  covers them).
- **One fix before screen 4:** date each result from its test, not from the
  last save (see above). This is a code change to how results are stamped, not
  a new field.
- A **required DOK** per standard, if you want the outline, would be a new
  field: the teacher's required DOK per standard. Under this repo's rule, a new
  workspace field has to be added to both `sync_workspace` and
  `get_workspace_json` in a migration, and proven with a save and reload,
  before it ships.

#### Effort [estimated, working days]

| Step | Effort | AI cost per class set |
|---|---|---|
| 1. One mastery rule | 1 day | $0 |
| 2. Class analysis by band, extension recommendation | 1–2 days (reteach buttons and error lists exist). The by-student table and printed report planned above are separate, about 2–3 more | $0 for the labels. The lesson planner costs what a lesson costs today, and only when the teacher taps |
| Fix: date results from the test | 1 day | $0 |
| 3. Standards report, tested only, tap for students | 2 days | $0 |
| 4. Tracker (extend "Progress over time") | 1–2 days | $0 |
| 5. Standards × DOK grid | 2–3 days (extends the DOK breakdown); 2 more for a teacher-set required DOK | $0 |

We could not measure what one generated lesson costs: the request type is
cleared from each scan after 48 hours [VERIFIED, `scans.params`], so 201 of the
last 30 days' 217 requests no longer say what they were. Nothing in this plan
generates a lesson by itself.

#### Order to build it in

1. **The mastery rule first.** Everything else reads from it, and it ends
   today's three disagreeing cut-offs.
2. **Class analysis by band**, with the by-student table and printed report
   above. This is the screen used after every test.
3. **The date fix**, before anything shows results over time.
4. **Standards report, tested only.** Small, and it is the tap-through into the
   tracker.
5. **The tracker.** It would show single bars until the first retest, so it is
   worth having in place before that happens.
6. **The DOK grid last.** Its data is the thinnest today: no DOK 3 or 4
   questions yet, no real required DOK, and few error types.

#### Things to talk through with Ricky and Michael before building

- **Short tests land on the edges.** A percentage is only as fine as the number
  of questions behind it. With one question on a standard, a student can only
  be 0% (Developing) or 100% (Exceeding). With three questions, two right is
  67% (Developing). With four, three right is 75% (Approaching). On a 4-point
  writing trait, a 3 is 75% (Approaching) and a 4 is 100% (Exceeding), so **no
  single 4-point trait can ever be Proficient**. Options: show the band only
  when a standard has enough questions (say 4 or more) and "too few questions
  to say" otherwise; or map writing levels to bands directly (4 Exceeding,
  3 Proficient, and so on). This needs your call.
- **What counts as "mastered"?** Ricky's spec gives bands, not a "mastered"
  line. We have assumed mastered means Proficient or better (80%+). If so,
  today's class-analysis "strong" line moves from 70 to 80, and a standard that
  showed "75% of students mastered" could show fewer, with no grade changed. We
  would say so on the screen the first time.
- **Two meanings of "Developing".** Insights' "Developing" is 65–79% today;
  Ricky's is 69% or below. The rule would switch everywhere at once, so the two
  meanings are never on screen together.
- **"Building evidence" in Insights.** That map waits for three results before
  saying "Mastered", and averages the last three. Should the bands apply to the
  latest result, to the average of the last three, or keep waiting for three?
  This is a teaching call.
- **Hover doesn't exist on an iPhone.** Ricky uses iPhone Safari [REPORTED by
  Troy]. "Hover for the most common errors" would be a tap
  that opens the detail, on every device, so it works the same on a phone and
  a laptop.
- **Required DOK.** The state's standards don't give one, and the catalog's
  "DOK 2" is a placeholder. Options:
  - (a) leave the outline out;
  - (b) the teacher sets it per standard, once (a new saved field, see above);
  - (c) the AI suggests one per standard. This is unmeasured, would cost
    something per standard, and is a guess the teacher would still check.

  We suggest (a) to start and (b) if Ricky misses it.
- **DOK is the AI's read of each question.** The grid is only as right as those
  reads, and the teacher can change any of them when reviewing questions.
- **Small cells.** On one test, most standard × DOK cells would hold zero or one
  question, so a cell's colour could rest on one answer. Each cell would show
  how many questions it covers.
- **Most common errors needs error types.** Only 24 of 316 answers have one
  today. The tap view would say "no error types recorded" rather than looking
  empty by mistake.
- **Privacy.** The grid and the tracker show individual students. They are for
  the teacher's eyes, like the class printout; the per-student page is the one
  to share with a family.

#### What we need from you

- **Ricky:** is "mastered" Proficient or better (80%+)?
- **Ricky:** in the tracker, is an "attempt" each test that included the
  standard (what we have saved), or only tests you mark as a retest?
- **Ricky:** for "the standards report", do you mean the test's Standards report
  tab, the class Standards heatmap in Insights, or both?
- **Ricky:** is the grid per test (our assumption), or across every test the
  class has taken?
- **Ricky:** for Exceeding, is a recommendation with a button to the lesson
  planner enough, or should the app draft the extension lesson straight away
  (which costs something each time)?
- **Both:** short tests and writing traits: show "too few questions" below a
  minimum, map writing levels to bands, or both?
- **Both:** which "Mastered" rule for Insights (see above)?
- **Both:** required DOK: leave it out to start (our suggestion), or have
  teachers set it?

---

## 4. Saved-assessment library

### What was asked
[REPORTED] Keep a test you've already set up (questions, answer key, standards,
points) and give it again, next year or to another class, without re-scanning
it.

### What exists today [VERIFIED in `components/teacher-assessments.tsx`]
- One test can be used in several classes at once. On the test's page, the
  class name has a **Change** link that opens "Use this assessment in". The
  questions and key are shared, and each class keeps its own student work.
- There is no way to make a **fresh, separate copy** with no student work, and
  no list of past tests to start from.
- The app has no "archive" for tests. [VERIFIED: the `archived_at` column is
  never set, and the load function skips archived rows.] So "last year's tests"
  means tests still in your account.

### Data needed
- A copy holds:
  - the questions;
  - the key;
  - the standards;
  - points;
  - the passage;
  - the rubric.
- It holds **no** student answers, **no** scans and **no** photo references.
  Those belong to the students who took it.
- Every copied question gets a **new id**. Student answers are linked to
  question ids, so reusing an id could tie the copy to the original's work.
- Already stored: everything copied. A "copied from" link would be a new field
  and need the usual migration. It is optional.
- Listing archived tests would need new work, because nothing is archived
  today. This plan doesn't include archiving.

### Screens
- "Start from a saved test" on the new-assessment screen: a searchable list of
  your tests, showing title, grade, standards and question count.
- "Make a fresh copy" on any test: the copy opens on the answer-key step with
  everything confirmed, ready for a class.

### AI cost per class set
**$0 per reuse.** Reuse actually saves money: it skips the test read (**$0.0054**)
and the key check (**$0.0023**) [VERIFIED: averages over 9 and 7 requests in
`scans`].

### Risks
- **Student work copied by mistake.** The copy must be built from a fixed list
  of fields, not by copying everything and deleting some. A test would prove a
  copy has no answers, scans or photo references, and only new question ids.
- **Standards that have since changed.** If your standards list has changed
  since the test was made, a copied code may no longer exist. The copy flags
  those questions for a quick re-pick instead of blanking them.
- **Sharing between teachers** (a school-wide library) is a different decision.
  It means one teacher's materials are visible to another, so it is left out on
  purpose.

### What we need from you
- **Both:** copy only within your own account for now, or is a shared school
  library something you want us to plan next?

---

## 5. Three smaller decisions from the accuracy work (PR 2, #125, built, not yet live)

### 5.1 Grouping identical answers reached by different work
- **What we found.** [VERIFIED] On one of Ricky's percents tests, all 8 answers
  the replay counts as "grouped wrong" were the same answer that Ricky gave
  different credit, because the work differed. 0 were wrongly marked correct
  and 0 were wrongly left blank.
- **The decision.** Today the app groups by *answer*. Should it also split a
  group when the work looks different?
- **The cost of splitting:** one extra look per answer group.
  - **Estimated:** about 4 groups per question × 10 questions = 40 small
    requests. Each is one page image plus a short instruction: about 1,500
    input tokens at $0.20 per million, plus 200 output at $1.20 per million,
    which is about $0.0005.
  - Total: about **$0.02 per class set**, and slower.
- **The alternative:** keep grouping by answer and let you split a group with
  one tap. AI cost: $0.

### 5.2 Ricky: a decimal written for a percent
- **What we found.** [VERIFIED] On that test, 2 answers written as a decimal
  where the key was a percent were given full credit by you. The app didn't
  pre-mark them as matching the key.
- **The question.** Do you always accept the decimal form, or only on some
  questions?
- **The risk.** If "always", the app treats them as equal on percent questions.
  That would be wrong on a question that asks for the answer *as a percent*.

### 5.3 "What the student actually wrote"
- **What we found.** [VERIFIED] The app keeps what the AI *read*, not a
  corrected version. When the read is wrong and you fix the grade, we can't
  measure reading accuracy against your correction.
- **The proposal.** A "the student actually wrote ___" box on an answer would
  fix that. It would make the reading score in PR 2 real instead of circular.
- **What it needs.** It is a new saved field, so it needs the migration and the
  save-and-reload proof.

## 6. The automatic camera and the page guide (your decision; nothing changed yet)

### What exists today [VERIFIED in `components/scan-camera.tsx` and `lib/auto-snap.ts`]
- **Auto capture.** When the camera sees a whole page and the phone is held
  steady for about half a second, it takes the picture by itself, then waits for
  the page to change before it can take another. It is **on by default** (Ricky's
  request) and has an **Auto / Manual** button; the choice is remembered on that
  phone. The shutter button always works too.
- **The page guide.** The outline drawn around the page while you aim. It is what
  tells auto capture a page is there. It does **not** crop the photo: what is saved
  is exactly what the screen shows.
- Both are covered by tests (`tests/auto-snap.test.mjs` and eight camera tests).

### The options

| | What you would see | Effort |
|---|---|---|
| **A. Keep it as it is** | Auto on, with the button to switch to Manual. | None. |
| **B. Auto off by default** | The camera opens in Manual: nothing is taken until you tap. The Auto button stays, and a teacher who turns it on keeps it on. | About half a day: one default and the tests that assume Auto. Teachers who already chose keep their choice; to reset everyone, a little more. |
| **C. Remove auto capture** | Tap the shutter for every page. The page guide stays, as an aiming aid only, or goes too (C2). | About a day: the auto-snap code and its tests come out and the camera tests are reworked; the "Hold steady or tap the shutter" hint goes with it. C2 adds about half a day to remove the outline. The "too blurry -- move a little farther" check stays either way: it comes from the sharpness check, not the outline. |

### Risks
- **Auto on (A):** a page snapped while still moving, or the same page twice when
  the outline loses the page and finds it again. Blurry shots are already caught
  and retaken. [INFERRED] We have no count of how often either happens.
- **Auto off (B, C):** one tap per page. On a 30-student, 2-page class set that is
  60 taps, which auto capture was asked for to save.
- Neither choice changes what is saved or what it costs: a page is a page.
- Not tested on a real iPhone (Safari); every camera check here runs in Chrome.

### What we need from you
- Which of A, B or C, and for C whether the page guide stays.
- If you have seen a double or a mid-movement snap, roughly how often -- that is
  the number that decides between A and B.
