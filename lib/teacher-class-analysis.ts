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

/** One error type and the students who made it, most common first. */
export type ErrorTypeTally = {
  errorType: string;
  students: Student[];
  /** How many tagged answers carried this error type (an answer per student
   * per question), so a student who made it on two questions counts twice. */
  count: number;
};

export type StandardMastery = {
  standard: Standard;
  strong: Student[];
  weak: Student[];
  notGraded: Student[];
  percentMastered: number | null;
  instruction: "Whole class" | "Small group" | "On track";
  /** The error types tagged on this standard's answers, most common first. */
  errorTypes: ErrorTypeTally[];
};

const MASTERY_THRESHOLD = 70;

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
  /** Mean confirmed level as a percentage of the dimension's max, or null. */
  averagePercent: number | null;
  /** The mean level shown against the max, e.g. "3.1 / 4", or "—". */
  averageLabel: string;
  strong: Student[];
  weak: Student[];
  notScored: Student[];
};

/**
 * Per-dimension class breakdown for a writing assessment, from the teacher's
 * confirmed rubric scores -- no AI call. Mirrors classAnalysis for key-based
 * assessments: only confirmed scores count, a student at or above the mastery
 * threshold is "strong", the rest "weak", and students with no confirmed score
 * on that dimension are listed separately.
 */
export function writingClassAnalysis(
  a: Assessment,
  students: Student[],
): WritingDimensionSummary[] {
  return rubricDimensions(a).map((dimension) => {
    const max = dimension.max > 0 ? dimension.max : 4;
    const strong: Student[] = [];
    const weak: Student[] = [];
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
      (responseMatch(r) >= MASTERY_THRESHOLD ? strong : weak).push(student);
    }
    const averageLevel = levels.length
      ? levels.reduce((sum, n) => sum + n, 0) / levels.length
      : null;
    return {
      dimension,
      averagePercent:
        averageLevel === null ? null : Math.round((averageLevel / max) * 100),
      averageLabel:
        averageLevel === null
          ? "—"
          : `${(Math.round(averageLevel * 10) / 10).toFixed(1)} / ${max}`,
      strong,
      weak,
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
      const strong: Student[] = [];
      const weak: Student[] = [];
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
        const average = Math.round(
          responses.reduce((sum, r) => sum + responseMatch(r), 0) /
            responses.length,
        );
        (average >= MASTERY_THRESHOLD ? strong : weak).push(student);
      }
      const assessed = strong.length + weak.length;
      const qIds = new Set(qs.map((q) => q.id));
      return {
        standard,
        strong,
        weak,
        notGraded,
        errorTypes: tallyErrorTypes(
          a.responses.filter((r) => qIds.has(r.questionId)),
          students,
        ),
        percentMastered: assessed
          ? Math.round((strong.length / assessed) * 100)
          : null,
        instruction: (!assessed || !weak.length
          ? "On track"
          : weak.length >= Math.ceil(assessed / 2)
            ? "Whole class"
            : "Small group") as StandardMastery["instruction"],
      };
    });
  return rows.sort((a, b) => (a.percentMastered ?? 101) - (b.percentMastered ?? 101));
}

export function classAnalysisReport(a: Assessment, analysis: StandardMastery[]) {
  const graded = analysis.reduce(
    (sum, row) => sum + row.strong.length + row.weak.length,
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
          row.percentMastered === null
            ? "Not yet graded for this class"
            : row.percentMastered + "% of graded students showed mastery",
          "Strong (" +
            row.strong.length +
            "): " +
            (row.strong.map((s) => s.name).join(", ") || "None yet"),
          "Needs reteaching (" +
            row.weak.length +
            "): " +
            (row.weak.map((s) => s.name).join(", ") || "None"),
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
        lines.push("Suggested next step: " + row.instruction);
        return lines.join("\n");
      })
      .join("\n\n") +
    cognitiveReportSection(a) +
    commonErrorSection(analysis) +
    "\n\nGenerated instantly from this assessment's graded responses — no additional AI review."
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
