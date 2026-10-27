# Super grids: class and student, across every test -- design

**Design only. Nothing here is built.** Written 26 Oct 2026 from Ricky's
messages in #app-ideas (22 Oct 2026, three messages, 07:40 and 17:05–17:08 PT),
checked against `main` at `8fed187` and the production `standards` and `classes`
tables (read-only). Everything below is a proposal to talk through with Ricky
before any of it is built (CLAUDE.md, "Talk the design through").

## 0. What Ricky asked for, in his words

1. **A class super grid.** "Imagine if the data for every assessment was being
   compiled in a super grid … for the super grid it would be a standard cluster
   so for instance 7.RP which is all the standards that have to deal with ratios
   … by DOK." Standard clusters down the side, DOK 1–4 across, "by percentage how
   your class did". It "existed for every class".
2. **A tap panel.** "You click the cell and it gives pre-teach options based upon
   common error analysis within that cluster for that DOK level, it gives how
   many questions have been assessed within the school year for this class within
   that standard cluster. It breaks up how many questions were asked more than 30
   days ago [and] within the last 30 days."
3. **Why.** "Insight into what they could be doing in the future, not just
   re-teaching the last assessment." The test's DOK grid (D1, live) "should be
   compiling into a class super grid that helps teachers with their pre-teach the
   next unit."
4. **A student super grid.** The same, for one student, across every test they
   have done, "something that we can generate a summary report from for teacher,
   parent conferences" -- and IEP meetings (17:08).
5. **The left menu.** Three key buttons: **New assessment**, **Class insights**
   ("plan your next lesson better, tailored to your class") and **Student
   insights** ("individualized student learning … progress reports for teacher,
   parent conferences, and IEP meetings").
6. **Clusters keep it readable.** "Not too messy having 30 different standards,
   but more concise" -- for Math 7: "ratios and proportions, geometry,
   statistics and others".

## 1. What a "cluster" is here (a word to settle with Ricky first)

Ricky's "7.RP" is what Common Core calls a **domain** (Ratios and Proportional
Relationships). Common Core's own word **cluster** is one level smaller: 7.RP.A,
"Analyze proportional relationships…". Grade 7 math has **5 domains** and about
**10 clusters**. Ricky's examples (ratios, geometry, statistics) are domains, and
5 rows is the "concise" grid he wants. So:

> **Proposal: a super-grid row is a domain** (7.RP, 7.G, 7.SP, 7.EE, 7.NS),
> labelled the way Ricky says it ("Ratios & Proportions · 7.RP"), and the app
> calls it a "cluster" on screen because that is the teacher's word.

Common Core's finer clusters (7.RP.A) could be a "show more detail" toggle
later. For high school the domain is the right row as well: Algebra is a
*conceptual category* holding four domains (A-SSE, A-APR, A-CED, A-REI). A
row of "Algebra" would mix those four, and a row per standard would be too many.

## 2. How clusters are worked out, framework by framework

Every standard the app knows already carries a `domain` and a `cluster` field
(`Standard` in `lib/teacher-types.ts`). The bundled catalogs carry the official
ones (`lib/california-grade-*.json`). Catalogs for other states are fetched by
the AI on request (`catalog` mode, `lib/analyze-shared.ts`), and their `domain`
is the AI's text. What production holds today (read-only, 26 Oct):

| Framework in use | Classes | Code shape | Domain field |
|---|---|---|---|
| Common Core (grade 4) | 3 | `CCSS.MATH.CONTENT.7.EE.A.1`, `CCSS.ELA-LITERACY.L.7.1.A` | official: 5 math domains for grade 7 ("Ratios and Proportional Relationships"…), 5 ELA strands |
| California (grades 7, 11) | 2 | `7.EE.1`, `A-APR.1`, `RL.7.1` | official, high school as "Algebra—Creating Equations" |

So the rule, in order:

1. **The catalog's `domain` field is the cluster.** It is official for every
   bundled and Common Core catalog. Two catalogs naming the same domain
   differently (California's "Algebra—Creating Equations" against a future
   "Creating Equations") are matched after tidying: case, "&" and "and", and
   dashes.
2. **The short label comes from the code when its shape is known:**
   - Common Core / California grade-level math: `7.RP.1` and
     `CCSS.MATH.CONTENT.7.RP.A.1` → **7.RP**.
   - California / Common Core high school: `A-CED.1`, `HSA-CED.A.1` → **A-CED**.
   - ELA (both): `RL.7.1`, `CCSS.ELA-LITERACY.RL.7.1` → **RL** (Reading:
     Literature); `W` Writing, `L` Language, `RI`, `SL`.
   - Florida B.E.S.T.: `MA.7.AR.1.1` → **AR** (Algebraic Reasoning);
     `ELA.7.R.1.1` → **R**.
   - Others are not parsed: Texas TEKS `7.4(A)`, Virginia SOL `7.1`, and other
     states whose codes carry no domain letters. They show the domain name
     alone.
3. **Fallback.** A standard with no domain at all (a teacher-added one, or an
   AI catalog that left it blank) goes in a row called **"Other standards"**.
   Nothing is dropped silently, and the row says how many standards are in it.

All of this would live in one pure function, `clusterOf(standard)`, with a test
per code shape above. The super grid never asks the AI to group standards: that
would make the rows change from one day to the next.

## 3. The class super grid

**Where.** A new screen, **Class insights** (Ricky's name, and already the
title of the existing `diagnostics` view), for the open class.

**Rows** are the clusters the class has actually been tested on, in catalog
order. **Columns** are DOK 1–4, exactly like the test DOK grid (D1), using the
same cell component, colours, "Not Tested" (#179) and phone layout.

**A cell's number** pools every confirmed answer the class gave on that
cluster's standards at that DOK, across every test given to the class:

- It is the average credit (`match`), each answer counting once, shown as a
  rounded percentage with the four levels (`masteryLevel`). The cell shows the
  same recommendation the DOK grid shows.
- Tests graded Standards-Based store their 0–4 scores on the same 0–100 scale
  (`match = score × 25`), so they pool without conversion. The cell reads as a
  percentage. **Question A for Ricky:** a class that grades everything 0–4 may
  want the super grid in 0–4 too. That is a per-class setting and a decision,
  not a calculation.
- Questions with no DOK are left out and counted in a note, as on the test grid.
  Excluded questions and unconfirmed answers never count, as everywhere.

**The tap panel** (same sheet as the D2 cell panel) shows:

- **Score and level** for the cell, with "based on N answers to Q questions
  across T tests". A cell on fewer than 5 answers says so plainly ("only 3
  answers so far -- a rough picture").
- **Questions assessed this school year**: Q in total, *of which* N in the last
  30 days and M earlier. The two need:
  - **A test date.** Today an assessment has only `createdAt`, which is when
    the test was *set up*, not when the class took it. Proposed: a `givenAt`
    date that defaults to the day its first student work is graded. A new
    workspace field has to go into both `sync_workspace` and
    `get_workspace_json` (CLAUDE.md, "Workspace persistence"), with a migration,
    a rolled-back check and a round-trip proof. Until then, `createdAt` is
    used and the panel says "by the date each test was added".
  - **A school year.** The app has no idea of one. Proposed: a setting, "School
    year starts on", defaulting to 1 August.
- **The standards inside the cell**, weakest first ("7.RP.3 -- 58%, 7.RP.1 --
  81%"), so the teacher sees which standard is pulling the cluster down.
- **Common errors** in the cell: the error types tagged across those tests, from
  the fixed lists (`lib/error-types.ts`), with counts. The "most common wrong
  answers" the test panel shows are left out here: they are per question, and
  a cluster across tests mixes different questions.
- **Pre-teach options**: "Plan a pre-teach lesson", opening the lesson
  generator for the cluster's weakest standard at that DOK, carrying the error
  types. **This is a prompt change** (a new `intent: "preteach"`, and possibly
  several standards in one lesson), so before it is built:
  - re-read `docs/student-data-flow.md` §4;
  - update §4 and `content/legal/` together.

  What it would send matches what D2 sends today: standard codes, DOK numbers,
  and error-type names with counts. It would never send a student's name, an
  answer, or a wrong-answer text.

## 4. The student super grid and its printable report

**Where.** **Student insights**: today's student page (`StudentsView`) with the
student chosen, gaining a super-grid section above "Evidence by standard".

**The grid** is the class grid for one student: the same rows, columns and
numbers, from that student's confirmed answers only. A cell shows "on 2
questions" under its number, because one student's cell rests on few answers.

**The summary report** ("Print summary" and "Download") is generated in the
browser from data already on the screen. Nothing new is sent anywhere, so
printing does not change `docs/student-data-flow.md`. It holds:

- the student's name, class, grade, and the date range it covers;
- the super grid, as a table that prints in colour and in black and white
  (each cell carries its level word, not just a colour);
- per cluster, one plain sentence ("Strongest at DOK 1–2 in Ratios &
  Proportions; DOK 3 reasoning is still Beginning, on 4 questions");
- progress on each standard tested more than once (the Standard Tracker);
- the teacher's own notes, only if they tick "include my notes".

**What it is not.** It is a progress summary from classroom tests, not an
assessment of disability, and it says so in its footer. An IEP team may use it
as one input. Wording is plain English, suitable for a parent.

## 5. The left menu

Ricky (22 Oct) asked for three key buttons at the top:

1. **New assessment.** Already the top button (`new-scan`).
2. **Class insights.** The class super grid, then today's insights (heatmap,
   levels, groups) below it.
3. **Student insights.** The student list and page, with the student super grid
   and report.

The rest (Overview, Assessments, Lesson plans, Classes, Standards, How to use)
moves below them, unchanged. **Question B for Ricky:** on 23 Oct he also
proposed a menu with "Overview" and an "Assessment Library" grouped by course.
The two lists need merging into one order before the menu is touched. A
proposed merged order:

- New assessment
- Class insights
- Student insights
- *divider*
- Overview
- Assessment library
- Lesson plans
- Classes
- *library section*: Standards, How to use

## 6. What is and isn't possible

**Possible with what is stored today:**

- every cell, from the confirmed answers, question DOKs and standards already in
  the workspace, worked out in the browser with no new AI call;
- the student grid and report;
- the error-type roll-up.

**Possible, but needs a decision or a new field first:**

- the 30-day split by the date a test was *given* (`givenAt`; until then, the
  date it was added);
- "this school year" (a school-year start setting);
- the grid in 0–4 for a Standards-Based class (Question A);
- a pre-teach lesson for a whole cluster rather than its weakest standard (a
  prompt change, §3).

**Not possible, or not honestly:**

- **Clusters for states whose codes carry no domain** (Texas, Virginia…) rest
  on the domain text the AI wrote when the catalog was fetched. They are
  consistent within a class, because a catalog is fetched once per state,
  grade and subject and then reused, but they are not official. The screen
  would say "groups from the state catalog's strands".
- **Tests with no DOK on their questions** cannot be placed in a column.
  Older tests graded before DOK tagging will be under-counted until their DOKs
  are set in Assessment review. The grid says how many questions it left out.
- **A cluster across grades.** A class tested on grade 6 and grade 7 standards
  would show 6.RP and 7.RP as two rows. Merging them is a judgement, not a
  calculation.
- **Comparing two classes**, or a class against a school or district: there is
  no such data, and it is out of scope.
- **Students who left the class** keep their answers on old tests. Proposed:
  the class grid counts only students now on the roster, and says so.
- **"Most common wrong answers" across tests**: different questions, so
  pooling their wrong answers means nothing. Error types are the shared
  language (§3).
- **Precision.** A cell on a handful of answers is a hint, not a measure. The
  grid shows its size everywhere rather than hiding thin cells.

## 7. Cost and what does not change

- **No new AI calls** to draw either grid. The only new AI use is the optional
  pre-teach lesson, at the same cost as a lesson today.
- **No new student data leaves the app.** The grid and the report are worked out
  and printed in the teacher's browser.
- **Storage:** nothing new for the grids. `givenAt` and the school-year setting
  are two small fields, each under the workspace-persistence rule.

## 8. Questions for Ricky (plain words)

1. Is a "cluster" the big group (7.RP, all of ratios: 5 rows for grade 7), or the
   smaller Common Core cluster (7.RP.A: about 10 rows)? *We propose the big
   group.*
2. For a class graded 0–4, should the super grid read 0–4 or percentages?
3. When does your school year start, and should "this school year" reset then?
4. Should the 30-day count go by the day the class took the test? (We would add
   a date to each test, filled in when you grade it, which you can change.)
5. In the student report for a parent conference, what should *not* be there?
   For example your private notes (we propose they're off unless you tick them),
   or error-type names.
6. The menu: is the merged order in §5 right?

## 9. A build order, if Ricky says yes

1. `clusterOf` with its tests per framework (§2), and the class super grid
   reusing the DOK grid cell (§3), without the 30-day split.
2. The tap panel's counts, standards and error types, with `givenAt` and the
   school-year setting (migration, check file and round-trip proof).
3. The student super grid and printable report (§4).
4. The left menu (§5).
5. Pre-teach lessons (prompt change: §4 of the data-flow doc and `content/legal/`
   first).
