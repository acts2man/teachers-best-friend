import type { Assessment, Standard, Student } from "./teacher-types";
import { responseMatch } from "./teacher-metrics";
import { activeQuestions } from "./teacher-workflow";

export type StandardMastery = {
  standard: Standard;
  strong: Student[];
  weak: Student[];
  notGraded: Student[];
  percentMastered: number | null;
  instruction: "Whole class" | "Small group" | "On track";
};

const MASTERY_THRESHOLD = 70;

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
      return {
        standard,
        strong,
        weak,
        notGraded,
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
        lines.push("Suggested next step: " + row.instruction);
        return lines.join("\n");
      })
      .join("\n\n") +
    "\n\nGenerated instantly from this assessment's graded responses — no additional AI review."
  );
}
