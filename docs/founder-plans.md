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

Some plans lean on work that is **built but not yet live**. Pull requests
#123–#126 are open and waiting for review. Until they merge and deploy, nothing
in them is on the app you use. Each mention below says so.

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
  - Also built, not yet live: PR 1 (#124) makes a change to the AI settings
    count as a different test for reuse. Today, on the live app, a read made
    before a settings change can be reused after it.

### Proposed fix (in this order)
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
PR 1 (#124, built, not yet live) adds a regression replay with a `standards`
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
