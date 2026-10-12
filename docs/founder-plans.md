# Plans for founder approval: 12 Oct 2026

**Nothing in this document is built.** It sets out four plans, plus three smaller
decisions, for Ricky and Michael to approve, change or turn down before any code
is written. Each plan gives:

- what it needs from the data;
- the screens it would add or change;
- what the AI would cost per class set;
- what could go wrong;
- what we still need from you.

Every claim carries one of these tags:

- **[VERIFIED]**: checked today against the live database or the code. The
  query or file is named.
- **[REPORTED]**: one of you told us. We have not been able to check it.
- **[INFERRED]**: our best explanation. It is not proven yet.

Costs come from the `scans` table, the measured cost of real requests over the
last 30 days, at today's `pipeline_config` settings. A cost we have not measured
is labelled **estimated**, with the arithmetic shown. This document changes no
AI settings.

A "class set" means one test for a class of 26 students, 1 to 2 pages each.

---

## 1. Standards accuracy

### What you asked
Ricky: the standards the app suggests often aren't the ones he would pick.
Michael: scanning the same test twice gave different alignment numbers (78%,
then 75%).

### What we found
We compared Ricky's five most recent tests: the app's suggestion for each
question against the standard he saved. The app's suggestions are the AI's own
output, which `scans.result` keeps for 48 hours. Ricky's saved standards are in
`assessment_questions.standard_code`.

| Test (topic only) | Questions | App suggested a standard | Same as Ricky's saved standard |
|---|---|---|---|
| Algebra 2: exponential/log, read today | 10 | **0 of 10** (two reads, both empty) | n/a: Ricky set all 10 himself |
| Algebra 2: rational expressions | 15 | 15 of 15 | **15 of 15** |
| Grade 7: percents (2nd test) | 10 | 10 of 10 | **10 of 10** |
| Grade 7: percents | 10 | **0 of 10** | n/a: Ricky set all 10 himself |
| Algebra 2: exponential/log 2 | 10 | **0 of 10** (two reads, both empty) | n/a: Ricky set all 10 himself |

[VERIFIED by SQL against `scans` and `assessment_questions`]

So the problem isn't that the app picks the *wrong* standard. Whenever it gave
an answer on these five tests, it matched Ricky 25 times out of 25. The problem
is that on **3 of the 5 tests it gave no standard at all** for any question.
Ricky then had to assign them all himself (the "assign a standard to questions
1–10" tool sets the alignment to 0, which is how we can tell).

Across **every** test read on the app in the last 48 hours (9 reads, 100
questions, both of you), **75 of 100 questions came back with no standard**.
[VERIFIED: the only reads still on file. Older ones are deleted after 48 hours
by design.] Michael's one remaining read is 15 of 15 empty.

### Why it misses
The AI is choosing a standard. It is then being thrown away.

- **[VERIFIED]** On the empty questions, the AI's written reasoning names a code,
  for example "F-IF.7 is the closest catalog standard". Its *second-choice*
  standard field still holds real codes (F-IF.7, F-BF.1, 7.RP.3), and **those
  codes are in Ricky's catalog** (checked in the `standards` table).
- **[VERIFIED]** `lib/analyze-shared.ts` line 773 keeps the AI's first choice only
  if it matches a catalog code **character for character**. If it doesn't, the
  standard is blanked and its alignment and confidence are set to 0. Nothing is
  logged and nothing is kept.
- **[INFERRED]** The AI is writing its first choice in a form that is close to,
  but not the same as, the catalog's code. The official long forms are
  `7.RP.A.3` and `HSF-IF.C.7`, and there are sub-parts like `F-IF.7e`
  (California's own sub-part for graphing exponentials, which fits both
  exponential tests). We can't see the exact text, because the code that blanks
  it doesn't keep it. Step 1 below fixes that first, so we stop guessing.

### Why repeat scans differ (78% then 75%)
- **[REPORTED]** by Michael. We can't check his two reads, because both were
  deleted after 48 hours.
- **[VERIFIED in code]** The alignment percentage is an average of one AI score
  per question (`alignment()` in `lib/teacher-data.ts`). The AI doesn't give the
  identical score twice, and a few points per question is normal.
- **[VERIFIED in code]** A question whose standard was blanked (above) drops out
  of that average entirely. So a re-read that blanks one more question, or one
  fewer, moves the number for a reason that has nothing to do with the test.
- **[VERIFIED]** Since PR 1, re-reading an identical test with identical
  settings reuses the first read, so it gives the same answer. A teacher who
  changes the intended standards, the grade or the AI settings gets a fresh
  read, and a slightly different number.

### Proposed fix (in this order)
1. **Keep what the AI actually wrote.** Store the raw first-choice code next to
   the result for 48 hours, server side only, in the same `scans.result` row
   that already holds everything else. AI cost: none. One day of real use then
   shows the exact form being rejected.
2. **Accept close forms of a catalog code.** Only for a code that isn't an exact
   match, and only when this produces exactly one code that *is* in the
   catalog:
   - ignore case and spaces;
   - drop a `CCSS.MATH.CONTENT.` or `HS` prefix;
   - drop the cluster letter (`7.RP.A.3` becomes `7.RP.3`);
   - roll a sub-part up to its parent (`F-IF.7e` becomes `F-IF.7`) when the
     sub-part isn't in the catalog.
3. **Fall back to the second choice** when the first still doesn't match and
   the second does. Mark it with a lower confidence, so it shows as "check
   this".
4. **Ask the AI to choose from the list.** The request format can tell the AI
   that the standard must be one of the catalog's codes, or empty. This is the
   strongest fix. It may add a few hundred tokens to each read (**estimated**:
   54 codes × about 6 tokens ≈ 330 tokens ≈ $0.0001 per test). It goes in
   only with step 5's evidence, because it changes what the AI is asked.
5. **Never blank a choice silently.** If nothing matches, the question shows
   "The AI suggested *X*, which isn't in your standards list", and the teacher
   picks.

### Measuring the before and after
The regression replay from PR 1 already has a `standards` case type. Its score
is the share of questions where the app's standard equals the teacher's saved
standard. We'd use Ricky's five tests above as five cases.

**This is proven when** the same five tests, replayed, give:
- a standard on at least 95 of every 100 questions (today: 25 of 55 on these
  five, and 25 of 100 across everything on file);
- the same standard as Ricky's on at least 90% of questions;
- and a unit test passes `7.RP.A.3`, `F-IF.7e`, `HSF-IF.C.7` and ` f-if.7 `
  through as the right catalog code, while `8.EE.1` (not in a grade 7 catalog)
  is still refused.

### Data needed
- Already stored: the questions, the catalog and the saved standards.
- New: the raw AI code, kept for 48 hours only. No workspace field changes for
  steps 1–4.
- **One gap:** when a teacher changes a single question's standard by hand,
  the AI's alignment score stays on the question, so afterwards we can't tell a
  teacher's pick from the AI's. Fixing that needs a new `standardSource` field
  ("AI" or "teacher"). Under the rule in `CLAUDE.md`, that is a database
  migration that changes both save functions, and it must be proven with a
  save-and-reload test.

### Screens
- The "Check what each question measures" table gains one line per unmatched
  question: "The AI suggested *X*, which isn't in your list".
- The alignment figure is shown as "about 75%", with a note when questions have
  no AI score.

### AI cost per class set
- Steps 1–3 and 5: **$0 extra**.
- Step 4: **estimated** under $0.001 extra per test read. The read itself
  measures **$0.0054** on average (9 reads).

### Risks
- Rolling a sub-part up to its parent could turn a precise tag into a broader
  one. It's only done when the precise code isn't in the teacher's catalog, so
  nothing better is lost.
- Step 4 changes the AI request. The `docs/student-data-flow.md` section 4 check
  applies, though no student data is involved.

### What we need from you
- **Ricky:** for the two exponential/log tests, is F-LE.4 the standard you
  wanted on every question, or did you use it because the app gave you nothing?
  The AI's reasoning pointed at F-IF.7 (graphing) and F-BF.3 (transformations)
  for some of them.
- **Both:** should a question the AI can't place be left empty for you to
  choose (today's behaviour, made visible), or filled with your intended
  standard and marked "check this"?

---

## 2. Glow and grow feedback

### What you asked
For each student, one thing they did well (glow) and one thing to work on
(grow), to hand back with the test.

### Data needed
All of this already exists and is saved [VERIFIED]:
- per student, the confirmed answers with credit;
- the standard of each question;
- the error type the teacher tagged (`errorType`);
- class mastery per standard (`teacher-class-analysis.ts`).

Nothing new needs storing unless the teacher edits the wording (see Risks).

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

Without names this doesn't break a published commitment, but section 4 of
`docs/student-data-flow.md` and the legal pages must say it before it ships.

AI cost, **estimated**: 26 students × 10 questions ≈ 4,000 input tokens plus
1,000 of instructions, at $0.20 per million, is $0.001. About 3,000 output
tokens at $1.20 per million is $0.0036. **Total about $0.005 per class set.**

**We recommend A first.** It costs nothing, can't invent anything, and shows
whether you actually use the slips. B can be added on top if the wording feels
flat.

### Screens
- A "Glow & grow" panel on the class analysis tab: one card per student, each
  editable before printing.
- A print view with one slip per student, several to a page, to cut and hand
  back.

### Risks
- Feedback built from answers you haven't confirmed yet. It is only built once
  every answer is confirmed (the PR 3 green step already enforces this before
  class analysis).
- For K-2, an error-type label like "sign error" isn't a sentence a child can
  read. Michael, we'd need your wording.
- If edits must survive a reload, the edited text is a new saved field and
  needs a migration plus a save-and-reload proof.

### What we need from you
- **Michael:** two or three glow and grow sentences you'd actually write for
  K-2 and for grades 4–6, so the wording fits the age.
- **Both:** A, B, or A now and B later?

---

## 3. Class analysis per standard and per student, plus a printable report

### What exists today [VERIFIED in `components/teacher-assessments.tsx`]
- The class analysis tab, per standard: percent mastered, who is strong, who
  needs help, whole-class or small-group, and the error types.
- "Print" and "Download report". These print **plain text**, not a table.

### What's missing
- A **per-student** view: each student's score, points, and how they did on
  each standard of this test.
- A printout that looks like a report, not a text file.

### Ricky's example
Ricky's example row, with a made-up name: "Miles Morales 88% 14/16 27/40".

**[INFERRED]** We read this as percent, questions right out of questions, and
points earned out of points possible. But 27/40 is 67.5%, not 88%, so at least
one of those readings is wrong. **We need Ricky to tell us what each number
is** before building it.

### Data needed
- All already saved: confirmed responses, points per question, the assessment's
  points total (`pointsPossible`, which PR 1's persistence guard now protects),
  and the standards.
- No new fields.

### Screens
- The class analysis tab gets a "By student" table:
  - columns: name, overall %, points, then one column per standard;
  - sortable;
  - on phones it becomes one card per student, like the PR 3 measures table.
- "Print class report": a real printed page, with the per-standard summary on
  top and the by-student table below, on one or two sheets.
- "Print student reports": one page per student, with their row, their
  per-standard results and (if plan 2 is approved) their glow and grow.

### AI cost per class set
**$0.** Everything comes from grades already saved.

### Risks
- **Partial grading read as final.** The report must say "still grading N
  answers" while any are unconfirmed; the screen already does.
- **Points versus percent.** A question with no points set counts as an even
  share. The report must use the same rule as the rest of the app
  (`questionPoints`), or the numbers will disagree between screens.
- **Privacy.** A printout with every student's score on one sheet is for the
  teacher only. The per-student pages are the ones to hand out.

### What we need from you
- **Ricky:** what are 88%, 14/16 and 27/40 in your example?
- **Both:** which columns, in what order?

---

## 4. Saved-assessment library

### What you asked
Keep a test you've already set up (questions, answer key, standards, points)
and give it again: next year, or to another class, without re-scanning it.

### What exists today [VERIFIED]
- "Share with classes" puts one assessment in several classes at once. Their
  results all stay together in that one assessment.
- There is no way to make a **fresh copy** with no student work, and no list of
  past tests to pick from.

### Data needed
- A copy holds:
  - the questions;
  - the key;
  - the standards;
  - points;
  - the passage;
  - the rubric.
- It holds **no** student responses, **no** scans and **no** photo references.
  Those belong to the students who took it.
- Already stored: everything copied. A "copied from" link would be a new field
  and need the usual migration. It is optional.

### Screens
- "Start from a saved test" on the new-assessment screen: a searchable list of
  your past tests (including archived ones), showing title, grade, standards and
  question count.
- "Make a fresh copy" on any assessment: the copy opens on the answer-key step
  with everything confirmed, ready for a class.

### AI cost per class set
**$0 per reuse.** Reuse actually saves money: it skips the test read (**$0.0054**
measured) and the key check (**$0.0023** measured).

### Risks
- **Student work copied by mistake.** The copy function must build a new
  assessment from an allow-list of fields, not copy everything and delete some.
  A test would prove a copy has no responses, scans or upload references.
- **Standards drift.** If the catalog has changed since the test was made, a
  copied code may no longer exist. The copy would flag those questions for a
  quick re-pick instead of blanking them.
- **Sharing between teachers** (a school-wide library) is a different decision.
  It means one teacher's materials are visible to another, so it is left out on
  purpose.

### What we need from you
- **Both:** copy only within your own account for now, or is a shared school
  library something you want us to plan next?

---

## 5. Three smaller decisions from PR 2's measurements

1. **Grouping identical answers that were reached by different work.**
   - [VERIFIED] On Ricky's percents test, the 8 answers the replay counts as
     "grouped wrong" are all the same answer that Ricky gave different credit,
     because the work differed. 0 were wrongly marked correct and 0 were wrongly
     left blank.
   - Today the app groups by *answer*.
   - Should it also split a group when the work looks different? That costs one
     extra look per group. **Estimated:** under $0.01 per class set, and
     slower.
   - The alternative is to keep grouping by answer and let you split a group
     with one tap.
2. **Ricky: ".15" for "15%".**
   - [VERIFIED] On that test, 2 answers written as a decimal (.15 and .10) were
     given full credit by you, but the app didn't pre-mark them as matching the
     key.
   - Do you always accept the decimal form of a percent, or only on some
     questions? If always, the app can treat them as equal on percent questions.
3. **"What the student actually wrote."**
   - [VERIFIED] The app keeps what the AI *read*, not a corrected version. So
     when the read is wrong and you fix the grade, we can't measure reading
     accuracy against your correction.
   - A "the student actually wrote ___" box on an answer would fix that. It is a
     new saved field and needs the migration and save-and-reload proof.
   - It would make PR 2's reading score real instead of circular.
