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
