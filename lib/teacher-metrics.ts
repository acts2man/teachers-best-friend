import { mastery } from "./teacher-data";
import type {
  Assessment,
  Question,
  Standard,
  Student,
  StudentResponse,
} from "./teacher-types";

export const costasLevels = [
  {
    level: 1 as const,
    name: "Gathering",
    description: "Recall, identify, define, or locate information.",
  },
  {
    level: 2 as const,
    name: "Processing",
    description: "Compare, organize, infer, explain, or analyze relationships.",
  },
  {
    level: 3 as const,
    name: "Applying",
    description:
      "Evaluate, predict, generalize, justify, or create in a new context.",
  },
];

export function costaFor(
  question: Pick<Question, "dok" | "costas">,
): 1 | 2 | 3 {
  return question.costas || (question.dok <= 1 ? 1 : question.dok >= 4 ? 3 : 2);
}

export function responseMatch(
  response: Pick<StudentResponse, "correct" | "match">,
) {
  return Math.max(
    0,
    Math.min(100, response.match ?? (response.correct ? 100 : 0)),
  );
}

/**
 * One cognitive-demand band's picture: how many of the assessment's questions
 * sit at this level, how many answers have been graded at it, and the average
 * answer match across those graded answers. Used for both the DOK (1-4) and
 * Costa (1-3) breakdowns, per student and for the whole class.
 */
export type CognitiveRow = {
  level: number;
  name: string;
  /** Active questions on the assessment at this level. */
  questions: number;
  /** Verified responses graded at this level (across the students passed in). */
  assessed: number;
  /** Average answer match across the graded answers, or null when none graded. */
  percentCorrect: number | null;
};

function levelBreakdown(
  questions: Question[],
  responses: StudentResponse[],
  levels: { level: number; name: string }[],
  levelOf: (q: Question) => number,
): CognitiveRow[] {
  const active = questions.filter((q) => !q.excluded);
  const byId = new Map(active.map((q) => [q.id, q]));
  // Only verified answers count toward "% correct", the same rule the class and
  // student mastery numbers already use -- an unreviewed answer is not yet
  // confirmed right or wrong.
  const graded = responses.filter((r) => r.verified && byId.has(r.questionId));
  return levels
    .map(({ level, name }) => {
      const rs = graded.filter((r) => levelOf(byId.get(r.questionId)!) === level);
      return {
        level,
        name,
        questions: active.filter((q) => levelOf(q) === level).length,
        assessed: rs.length,
        percentCorrect: rs.length
          ? Math.round(
              rs.reduce((sum, r) => sum + responseMatch(r), 0) / rs.length,
            )
          : null,
      };
    })
    // Only levels the assessment actually assesses -- an empty DOK 4 row is noise.
    .filter((row) => row.questions > 0);
}

/** % correct at each Webb DOK level (1-4) present on the assessment. */
export function dokBreakdown(
  questions: Question[],
  responses: StudentResponse[],
): CognitiveRow[] {
  return levelBreakdown(
    questions,
    responses,
    [1, 2, 3, 4].map((level) => ({ level, name: "DOK " + level })),
    (q) => Math.min(4, Math.max(1, q.dok || 1)),
  );
}

/** % correct at each Costa's level (1-3) present on the assessment. */
export function costaBreakdown(
  questions: Question[],
  responses: StudentResponse[],
): CognitiveRow[] {
  return levelBreakdown(
    questions,
    responses,
    costasLevels.map((c) => ({ level: c.level, name: "Costa " + c.level + " " + c.name })),
    (q) => costaFor(q),
  );
}

/** One line per cognitive band: "DOK 2: 78% correct across 5 questions (12 graded)". */
export function cognitiveReportLines(rows: CognitiveRow[]): string {
  return rows
    .map(
      (r) =>
        r.name +
        ": " +
        (r.percentCorrect === null
          ? "not yet graded"
          : r.percentCorrect + "% correct") +
        " across " +
        r.questions +
        " question" +
        (r.questions === 1 ? "" : "s") +
        " (" +
        r.assessed +
        " graded)",
    )
    .join("\n");
}

export function alignmentSuggestions(
  assessment: Assessment,
  catalog: Standard[],
) {
  const active = assessment.questions.filter((question) => !question.excluded);
  const targetCatalog = assessment.targetStandards
    .map((code) => catalog.find((standard) => standard.code === code))
    .filter((standard): standard is Standard => !!standard);
  const suggestions: {
    key: string;
    title: string;
    detail: string;
    questionId?: string;
  }[] = [];

  for (const standard of targetCatalog) {
    const matching = active.filter(
      (question) =>
        question.standard === standard.code ||
        question.secondary === standard.code,
    );
    if (!matching.length) {
      suggestions.push({
        key: `missing-${standard.code}`,
        title: `Add evidence for ${standard.code}`,
        detail: `Add a question that asks students to ${standard.skills[0]?.toLowerCase() || standard.summary.toLowerCase()}`,
      });
    }
  }

  for (const question of active) {
    if (!assessment.targetStandards.includes(question.standard)) {
      const target = targetCatalog[0];
      suggestions.push({
        key: `outside-${question.id}`,
        questionId: question.id,
        title: `Question ${question.number} is outside the selected standards`,
        detail: target
          ? `Revise it so students demonstrate ${target.title.toLowerCase()}, or exclude it from this alignment report.`
          : "Choose an intended standard, then revise or exclude this question.",
      });
    } else if (question.alignment < 80) {
      const standard = catalog.find((item) => item.code === question.standard);
      suggestions.push({
        key: `weak-${question.id}`,
        questionId: question.id,
        title: `Strengthen question ${question.number}`,
        detail:
          question.improvement ||
          `Require students to ${standard?.skills[0]?.toLowerCase() || question.skill.toLowerCase() || "show the grade-level skill and explain their reasoning"}.`,
      });
    }
  }

  return suggestions;
}

export function studentOverall(student: Student, catalog: Standard[]) {
  const scores = catalog
    .map((standard) => mastery(student, standard.code))
    .filter((score): score is number => score !== null);
  return scores.length
    ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
    : null;
}

export function performanceBands(students: Student[], catalog: Standard[]) {
  const bands = [
    {
      id: "high",
      name: "High",
      range: "80–100%",
      description: "Meeting or extending current standards",
      min: 80,
      max: 100,
      students: [] as Student[],
    },
    {
      id: "mid",
      name: "Mid",
      range: "65–79%",
      description: "Developing toward consistent understanding",
      min: 65,
      max: 79,
      students: [] as Student[],
    },
    {
      id: "low",
      name: "Low",
      range: "Below 65%",
      description: "Needs focused support and another check",
      min: 0,
      max: 64,
      students: [] as Student[],
    },
    {
      id: "none",
      name: "No evidence yet",
      range: "Not scored",
      description: "Ready for an initial check-in",
      min: -1,
      max: -1,
      students: [] as Student[],
    },
  ];
  for (const student of students) {
    const score = studentOverall(student, catalog);
    const band =
      score === null
        ? bands[3]
        : bands.find((item) => score >= item.min && score <= item.max)!;
    band.students.push(student);
  }
  return bands;
}

export function sharedGapGroups(students: Student[], catalog: Standard[]) {
  return catalog
    .map((standard) => {
      const members = students.filter((student) => {
        const score = mastery(student, standard.code);
        return score !== null && score < 70;
      });
      return {
        standard,
        students: members,
        instruction:
          members.length >= Math.ceil(students.length / 2)
            ? "Whole class"
            : "Small group",
        average: members.length
          ? Math.round(
              members.reduce(
                (sum, student) => sum + (mastery(student, standard.code) || 0),
                0,
              ) / members.length,
            )
          : 0,
      };
    })
    .filter((group) => group.students.length)
    .sort(
      (a, b) => b.students.length - a.students.length || a.average - b.average,
    );
}
