import { errorTypeForAi, errorTypesFor, onErrorList } from "./error-types";
import { average4, isSbg, score4Text } from "./grading-mode";
import type {
  Assessment,
  RubricDimension,
  Standard,
  Student,
  StudentResponse,
} from "./teacher-types";
import {
  cognitiveReportLines,
  costaBreakdown,
  dokBreakdown,
  responseMatch,
} from "./teacher-metrics";
import { activeQuestions, rubricDimensions } from "./teacher-workflow";
import {
  MASTERY_LEVELS,
  MASTERY_LEVELS_NOTE,
  masteryLevel,
  masteryLevel4,
  masteryPercent,
  SCORE4_RANGES,
  rubricLevel,
  type MasteryLevel,
  type MasteryLevelInfo,
} from "./mastery-levels";

/** One error type and the students who made it, most common first. */
export type ErrorTypeTally = {
  errorType: string;
  students: Student[];
  /** How many tagged answers carried this error type (an answer per student
   * per question), so a student who made it on two questions counts twice. */
  count: number;
};

/** Students sorted into the four levels (lib/mastery-levels.ts). */
export type ByLevel = Record<MasteryLevel, Student[]>;

const emptyLevels = (): ByLevel => ({ Beginning: [], Approaching: [], Proficient: [], Exceeding: [] });

export type StandardMastery = {
  standard: Standard;
  /** Every graded student, by their level on this standard. */
  byLevel: ByLevel;
  /** Beginning: the students the app recommends reteaching. */
  reteach: Student[];
  /** Exceeding: the students the app recommends extension for. */
  extend: Student[];
  notGraded: Student[];
  /** The class's average on this standard, rounded to the nearest whole
   * percent, or null. */
  averagePercent: number | null;
  /** On a Standards-Based test, the class's average on this standard out of 4
   * (unrounded; shown to one decimal), and every level above is on the 0–4
   * cuts. Null on a percentage test, or when nobody is graded. */
  average4: number | null;
  /** How to reteach the Beginning students; "No reteach needed" when none. */
  instruction: "Whole class" | "Small group" | "No reteach needed";
  /** The error types tagged on this standard's answers, most common first. */
  errorTypes: ErrorTypeTally[];
};

/**
 * Tallies the error types a teacher tagged across a set of responses, with the
 * students who made each. Untagged answers are ignored. Ordered most common
 * first so the class view leads with what most needs addressing.
 */
export function tallyErrorTypes(
  responses: StudentResponse[],
  students: Student[],
): ErrorTypeTally[] {
  const byId = new Map(students.map((s) => [s.id, s]));
  const byType = new Map<string, { students: Map<string, Student>; count: number }>();
  for (const r of responses) {
    const errorType = (r.errorType || "").trim();
    if (!errorType) continue;
    const entry = byType.get(errorType) || { students: new Map(), count: 0 };
    entry.count += 1;
    const student = byId.get(r.studentId);
    if (student) entry.students.set(student.id, student);
    byType.set(errorType, entry);
  }
  return [...byType.entries()]
    .map(([errorType, e]) => ({
      errorType,
      students: [...e.students.values()],
      count: e.count,
    }))
    .sort((a, b) => b.count - a.count || a.errorType.localeCompare(b.errorType));
}

/**
 * The error types tagged across the whole assessment, most common first, with
 * the students who made each. The assessment-level view Ricky and Michael asked
 * for; the per-standard version lives on each StandardMastery row.
 */
export function assessmentErrorTypes(
  a: Assessment,
  students: Student[],
): ErrorTypeTally[] {
  const active = new Set(activeQuestions(a).map((q) => q.id));
  return tallyErrorTypes(
    a.responses.filter((r) => active.has(r.questionId)),
    students,
  );
}

/**
 * The error types tagged on one student's answers across this assessment, most
 * common first. The per-student counterpart to assessmentErrorTypes, for the
 * student view and the student report.
 */
export function studentErrorTypes(
  a: Assessment,
  studentId: string,
): { errorType: string; count: number }[] {
  const active = new Set(activeQuestions(a).map((q) => q.id));
  const counts = new Map<string, number>();
  for (const r of a.responses) {
    if (r.studentId !== studentId || !active.has(r.questionId)) continue;
    const errorType = (r.errorType || "").trim();
    if (!errorType) continue;
    counts.set(errorType, (counts.get(errorType) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([errorType, count]) => ({ errorType, count }))
    .sort((a, b) => b.count - a.count || a.errorType.localeCompare(b.errorType));
}

/** One rubric dimension's class picture for a writing assessment. */
export type WritingDimensionSummary = {
  dimension: RubricDimension;
  /** The class's level on this trait, from the mean score on the 0–4 cuts
   * (rubricLevel), or null when nobody is scored. */
  level: MasteryLevelInfo | null;
  /** Mean confirmed level as a percentage of the dimension's max, rounded
   * to the nearest whole percent, or null. */
  averagePercent: number | null;
  /** The mean level shown against the max, e.g. "3.1 / 4", or "—". */
  averageLabel: string;
  /** Every scored student, by their level on this trait. */
  byLevel: ByLevel;
  notScored: Student[];
};

/**
 * Per-dimension class breakdown for a writing assessment, from the teacher's
 * confirmed rubric scores -- no AI call. Mirrors classAnalysis for key-based
 * assessments: only confirmed scores count, each student is placed in a
 * mastery level by their score as a percentage of the trait's max, and
 * students with no confirmed score on that dimension are listed separately.
 */
export function writingClassAnalysis(
  a: Assessment,
  students: Student[],
): WritingDimensionSummary[] {
  return rubricDimensions(a).map((dimension) => {
    const max = dimension.max > 0 ? dimension.max : 4;
    const byLevel = emptyLevels();
    const notScored: Student[] = [];
    const levels: number[] = [];
    for (const student of students) {
      const r = a.responses.find(
        (r) =>
          r.studentId === student.id &&
          r.questionId === dimension.id &&
          r.verified &&
          r.rubricScore !== undefined,
      );
      if (!r || r.rubricScore === undefined) {
        notScored.push(student);
        continue;
      }
      levels.push(r.rubricScore);
      // A rubric score is a 0–4 score: its level comes from the 0–4 cuts,
      // not from the score as a percentage (2 of 4 is Approaching, not 50%).
      byLevel[rubricLevel(r.rubricScore, max).level].push(student);
    }
    const averageLevel = levels.length
      ? levels.reduce((sum, n) => sum + n, 0) / levels.length
      : null;
    return {
      dimension,
      level: averageLevel === null ? null : rubricLevel(averageLevel, max),
      averagePercent:
        averageLevel === null ? null : masteryPercent((averageLevel / max) * 100),
      averageLabel:
        averageLevel === null
          ? "—"
          : `${(Math.round(averageLevel * 10) / 10).toFixed(1)} / ${max}`,
      byLevel,
      notScored,
    };
  });
}

/**
 * Per-standard class breakdown for one assessment, computed from the
 * questions/responses already captured — no AI call. Only responses the
 * teacher has verified count toward mastery, since unverified answers
 * haven't been confirmed correct or incorrect yet.
 */
export function classAnalysis(
  a: Assessment,
  students: Student[],
  catalog: Standard[],
): StandardMastery[] {
  const questions = activeQuestions(a);
  const sbg = isSbg(a);
  const codes = [...new Set(questions.map((q) => q.standard).filter(Boolean))];
  const rows: StandardMastery[] = codes
    .map((code) => catalog.find((s) => s.code === code))
    .filter((standard): standard is Standard => !!standard)
    .map((standard) => {
      const qs = questions.filter((q) => q.standard === standard.code);
      const byLevel = emptyLevels();
      const averages: number[] = [];
      const averages4: number[] = [];
      const notGraded: Student[] = [];
      for (const student of students) {
        const responses = qs.flatMap((q) => {
          const r = a.responses.find(
            (r) =>
              r.studentId === student.id && r.questionId === q.id && r.verified,
          );
          return r ? [r] : [];
        });
        if (!responses.length) {
          notGraded.push(student);
          continue;
        }
        // The unrounded average; masteryLevel rounds it once (59.5 is
        // Approaching, 59.4 is Beginning).
        const average =
          responses.reduce((sum, r) => sum + responseMatch(r), 0) /
          responses.length;
        averages.push(average);
        // Standards-Based: the mean of each answer's 0–4 score (answerScore4,
        // the one rule), on the 0–4 cuts.
        if (sbg) {
          const own = average4(responses.map(responseMatch))!;
          averages4.push(own);
          byLevel[masteryLevel4(own).level].push(student);
        } else byLevel[masteryLevel(average).level].push(student);
      }
      const assessed = averages.length;
      const reteach = byLevel.Beginning;
      const qIds = new Set(qs.map((q) => q.id));
      return {
        standard,
        byLevel,
        reteach,
        extend: byLevel.Exceeding,
        notGraded,
        averagePercent: assessed
          ? masteryPercent(averages.reduce((a, b) => a + b, 0) / assessed)
          : null,
        average4: sbg && assessed ? averages4.reduce((a, b) => a + b, 0) / assessed : null,
        errorTypes: tallyErrorTypes(
          a.responses.filter((r) => qIds.has(r.questionId)),
          students,
        ),
        instruction: (!reteach.length
          ? "No reteach needed"
          : reteach.length >= Math.ceil(assessed / 2)
            ? "Whole class"
            : "Small group") as StandardMastery["instruction"],
      };
    });
  return rows.sort((a, b) => (a.averagePercent ?? 101) - (b.averagePercent ?? 101));
}

/** The four Webb DOK levels, as the grid's columns. */
export const DOK_LEVELS = [
  { dok: 1, name: "Recall" },
  { dok: 2, name: "Skill & concept" },
  { dok: 3, name: "Strategic thinking" },
  { dok: 4, name: "Extended reasoning" },
] as const;

/** One cell of the DOK grid: the class on one standard at one DOK level. */
export type DokCell = {
  dok: 1 | 2 | 3 | 4;
  /** Active questions on this standard at this DOK. 0 is a grey "No
   * questions" cell. */
  questions: number;
  /** Students with at least one verified answer in the cell. */
  studentsGraded: number;
  /** The class's score: each student's mean answer match in the cell, then
   * the mean across students, rounded like every level-coloured number; null
   * when no answer in the cell is graded. */
  percent: number | null;
  /** The level of that score, or null with it. On a Standards-Based test,
   * the level of `score4`, on the 0–4 cuts -- as the class card. */
  level: MasteryLevelInfo | null;
  /** Standards-Based only: the class's 0–4 score in the cell, each student's
   * mean answer score (answerScore4) then the mean across students; null on
   * a percentage test or when nothing is graded. */
  score4: number | null;
  /** The questions in the cell, for its panel (D2). */
  questionIds: string[];
};

export type DokGridRow = { standard: Standard; cells: DokCell[] };

/**
 * The class DOK grid (docs/design/grading-modes-and-dok-grid.md 2.1-2.3):
 * one row per standard -- the same standards, in the same order, as the
 * class-analysis cards (classAnalysis), so the grid and the cards beside it
 * never disagree -- and one cell per DOK level 1-4.
 *
 * A cell counts the same answers the cards do: verified answers to the
 * assessment's active questions on that primary standard, now also at that
 * DOK. Each student's answers in the cell are averaged first, then the
 * students, as the card's "Class average" is.
 *
 * A question with no DOK (the column is nullable) is left out of every cell
 * -- not guessed as DOK 1 -- and counted in `noDok` so the screen can say so.
 * Percentage mode only (G2 reads the same cells in 0–4).
 */
export function dokGrid(
  a: Assessment,
  students: Student[],
  catalog: Standard[],
): { rows: DokGridRow[]; noDok: number } {
  const questions = activeQuestions(a);
  const sbg = isSbg(a);
  const dokOf = (q: { dok?: number | null }) =>
    q.dok === 1 || q.dok === 2 || q.dok === 3 || q.dok === 4 ? q.dok : null;
  const rows = classAnalysis(a, students, catalog).map(({ standard }) => ({
    standard,
    cells: DOK_LEVELS.map(({ dok }): DokCell => {
      const qs = questions.filter((q) => q.standard === standard.code && dokOf(q) === dok);
      const ids = new Set(qs.map((q) => q.id));
      const averages: number[] = [];
      const averages4: number[] = [];
      for (const student of students) {
        const rs = a.responses.filter(
          (r) => r.studentId === student.id && r.verified && ids.has(r.questionId),
        );
        if (rs.length) {
          averages.push(rs.reduce((sum, r) => sum + responseMatch(r), 0) / rs.length);
          averages4.push(average4(rs.map(responseMatch))!);
        }
      }
      const average = averages.length
        ? averages.reduce((x, y) => x + y, 0) / averages.length
        : null;
      const score4 = sbg && averages4.length ? averages4.reduce((x, y) => x + y, 0) / averages4.length : null;
      return {
        dok,
        questions: qs.length,
        questionIds: qs.map((q) => q.id),
        studentsGraded: averages.length,
        percent: average === null ? null : masteryPercent(average),
        level: score4 !== null ? masteryLevel4(score4) : average === null ? null : masteryLevel(average),
        score4,
      };
    }),
  }));
  return { rows, noDok: questions.filter((q) => dokOf(q) === null).length };
}

/**
 * What the DOK grid's cell panel shows about one cell (design doc 2.4): the
 * error types the teacher tagged on the cell's answers, from the subject's
 * fixed list, most common first; and the most common wrong answers, for a
 * subject or area with no list (ELA Language) or a cell nobody has tagged
 * yet. Verified answers only, like the cell's score. The wrong answers are
 * shown to the teacher; they are never sent to the AI (see lessonFocus).
 */
export function dokCellDetail(
  a: Assessment,
  students: Student[],
  questionIds: string[],
): { errorTypes: ErrorTypeTally[]; wrongAnswers: { answer: string; count: number }[] } {
  const ids = new Set(questionIds);
  const listed = errorTypesFor(a.subject, a.elaArea);
  const answers = a.responses.filter((r) => r.verified && ids.has(r.questionId));
  // A typed "Other" label is the teacher's own, shown here as they wrote it.
  const errorTypes = tallyErrorTypes(answers, students).filter((t) => onErrorList(listed, t.errorType));
  const wrong = new Map<string, { answer: string; count: number }>();
  for (const r of answers) {
    if (responseMatch(r) >= 100) continue;
    const answer = (r.finalAnswer || r.answer || "").trim();
    if (!answer) continue;
    const key = answer.toLowerCase().replace(/\s+/g, " ");
    const entry = wrong.get(key) || { answer, count: 0 };
    entry.count += 1;
    wrong.set(key, entry);
  }
  const wrongAnswers = [...wrong.values()]
    .sort((x, y) => y.count - x.count || x.answer.localeCompare(y.answer))
    .slice(0, 5);
  return { errorTypes, wrongAnswers };
}

/**
 * The DOK level a cell's next step aims at (Ricky, 20 Oct 2026): the cell's
 * own level, except an extension, which always aims one level up -- DOK 4
 * stays at 4.
 */
export function nextStepDok(level: MasteryLevelInfo, dok: number): number {
  return level.nextStep.intent === "extension" ? Math.min(4, dok + 1) : dok;
}

/**
 * What a lesson planned from a test's DOK grid is aimed at: the DOK levels
 * (1-4, each once, in order) and the error types the teacher tagged on that
 * standard's answers at those levels, as fixed-list names and counts only. This
 * is all that reaches the AI from the class's work -- no student, no answer,
 * no free text (docs/student-data-flow.md section 4).
 */
export function lessonFocus(
  a: Assessment,
  standard: string,
  doks: number[],
  /** The DOK level(s) the errors are counted at: the cell the teacher opened.
   * An extension aims one level up and a teacher can tick other levels, but
   * the mistakes to address are the ones the panel showed -- the cell's own
   * (review of #175). Defaults to `doks`. */
  errorsFrom?: number[],
): { dok: number[]; errorTypes: { name: string; count: number }[] } {
  const valid = (list: number[]) =>
    [...new Set(list.filter((d) => Number.isInteger(d) && d >= 1 && d <= 4))].sort();
  const dok = valid(doks);
  const from = errorsFrom && valid(errorsFrom).length ? valid(errorsFrom) : dok;
  const listed = errorTypesFor(a.subject, a.elaArea);
  const ids = activeQuestions(a)
    .filter((q) => q.standard === standard && from.includes(q.dok))
    .map((q) => q.id);
  // Every typed "Other" label counts as "Other": the teacher's words stay here.
  const counts = new Map<string, number>();
  for (const t of tallyErrorTypes(
    a.responses.filter((r) => r.verified && ids.includes(r.questionId)),
    [],
  )) {
    if (!onErrorList(listed, t.errorType)) continue;
    const name = errorTypeForAi(t.errorType);
    counts.set(name, (counts.get(name) ?? 0) + t.count);
  }
  const errorTypes = [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((x, y) => y.count - x.count || x.name.localeCompare(y.name))
    .slice(0, 10);
  return { dok, errorTypes };
}

export function classAnalysisReport(a: Assessment, analysis: StandardMastery[]) {
  const graded = analysis.reduce(
    (sum, row) => sum + MASTERY_LEVELS.reduce((n, l) => n + row.byLevel[l.level].length, 0),
    0,
  );
  return (
    a.title +
    " · Class analysis" +
    "\nGrade " +
    a.grade +
    " · " +
    a.subject +
    " · " +
    a.framework +
    "\nBased on " +
    graded +
    " graded standard checks across " +
    analysis.length +
    " standard" +
    (analysis.length === 1 ? "" : "s") +
    "\n\n" +
    analysis
      .map((row) => {
        const lines = [
          row.standard.code + " — " + row.standard.title,
          row.averagePercent === null
            ? "Not yet graded for this class"
            : row.average4 !== null
              ? "Class average " + score4Text(row.average4) + " out of 4 (" + masteryLevel4(row.average4).level + ")"
              : "Class average " + row.averagePercent + "% (" + masteryLevel(row.averagePercent).level + ")",
          ...MASTERY_LEVELS.map(
            (l) =>
              l.level +
              " " +
              (row.average4 !== null ? SCORE4_RANGES[l.level] : l.range) +
              " (" +
              row.byLevel[l.level].length +
              "): " +
              (row.byLevel[l.level].map((s) => s.name).join(", ") || "None"),
          ),
        ];
        if (row.notGraded.length)
          lines.push(row.notGraded.length + " student(s) not yet graded on this standard");
        for (const e of row.errorTypes)
          lines.push(
            e.errorType +
              " (" +
              e.count +
              "): " +
              e.students.map((s) => s.name).join(", "),
          );
        // Every level's recommendation and next step (lib/mastery-levels.ts),
        // for the levels that have students; the reteach says whole class or
        // small group.
        const steps = MASTERY_LEVELS.filter((l) => row.byLevel[l.level].length).map(
          (l) =>
            l.advice +
            ": " +
            l.nextStep.label +
            " (" +
            l.level +
            ", " +
            row.byLevel[l.level].length +
            (l.level === "Beginning" ? ", " + row.instruction.toLowerCase() : "") +
            ")",
        );
        if (steps.length) lines.push("Suggested next steps: " + steps.join("; "));
        return lines.join("\n");
      })
      .join("\n\n") +
    cognitiveReportSection(a) +
    commonErrorSection(analysis) +
    "\n\n" +
    MASTERY_LEVELS_NOTE +
    "\nGenerated instantly from this assessment's graded responses — no additional AI review."
  );
}

/** The DOK and Costa breakdowns for the class report, or "" when there's nothing graded. */
function cognitiveReportSection(a: Assessment): string {
  const dok = dokBreakdown(a.questions, a.responses);
  const costa = costaBreakdown(a.questions, a.responses);
  if (!dok.length && !costa.length) return "";
  let out = "\n\nCOGNITIVE DEMAND";
  if (dok.length) out += "\nBy Webb DOK\n" + cognitiveReportLines(dok);
  if (costa.length) out += "\nBy Costa's level\n" + cognitiveReportLines(costa);
  return out;
}

/** The most common error types across the whole assessment, most common first. */
function commonErrorSection(analysis: StandardMastery[]): string {
  const counts = new Map<string, { count: number; names: Set<string> }>();
  for (const row of analysis)
    for (const e of row.errorTypes) {
      const entry = counts.get(e.errorType) || { count: 0, names: new Set() };
      entry.count += e.count;
      for (const s of e.students) entry.names.add(s.name);
      counts.set(e.errorType, entry);
    }
  if (!counts.size) return "";
  return (
    "\n\nMOST COMMON ERROR TYPES\n" +
    [...counts.entries()]
      .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
      .map(
        ([errorType, e]) =>
          errorType + " (" + e.count + "): " + [...e.names].join(", "),
      )
      .join("\n")
  );
}
