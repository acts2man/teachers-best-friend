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
  masteryPercent,
  type MasteryLevel,
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

const emptyLevels = (): ByLevel => ({ Developing: [], Approaching: [], Proficient: [], Exceeding: [] });

export type StandardMastery = {
  standard: Standard;
  /** Every graded student, by their level on this standard. */
  byLevel: ByLevel;
  /** Developing: the students the app recommends reteaching. */
  reteach: Student[];
  /** Exceeding: the students the app recommends extension for. */
  extend: Student[];
  notGraded: Student[];
  /** The class's average on this standard, rounded down, or null. */
  averagePercent: number | null;
  /** How to reteach the Developing students; "No reteach needed" when none. */
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
  /** Mean confirmed level as a percentage of the dimension's max, rounded
   * down, or null. */
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
      byLevel[masteryLevel(responseMatch(r)).level].push(student);
    }
    const averageLevel = levels.length
      ? levels.reduce((sum, n) => sum + n, 0) / levels.length
      : null;
    return {
      dimension,
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
  const codes = [...new Set(questions.map((q) => q.standard).filter(Boolean))];
  const rows: StandardMastery[] = codes
    .map((code) => catalog.find((s) => s.code === code))
    .filter((standard): standard is Standard => !!standard)
    .map((standard) => {
      const qs = questions.filter((q) => q.standard === standard.code);
      const byLevel = emptyLevels();
      const averages: number[] = [];
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
        // The true average, never rounded first: 69.9 is Developing.
        const average =
          responses.reduce((sum, r) => sum + responseMatch(r), 0) /
          responses.length;
        averages.push(average);
        byLevel[masteryLevel(average).level].push(student);
      }
      const assessed = averages.length;
      const reteach = byLevel.Developing;
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
            : "Class average " + row.averagePercent + "% (" + masteryLevel(row.averagePercent).level + ")",
          ...MASTERY_LEVELS.map(
            (l) =>
              l.level +
              " " +
              l.range +
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
        lines.push(
          "Suggested next step: " +
            (row.reteach.length ? "reteach the Developing students (" + row.instruction.toLowerCase() + ")" : "no reteach needed") +
            (row.extend.length ? "; extension for the Exceeding students" : ""),
        );
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
