/**
 * The shapes the in-app regression replay works with. See
 * docs/regression-replay.md for what it is and how to run it.
 *
 * A CASE is one thing to check on one real assessment, with the values the
 * teacher confirmed in the app as the expected answer. Its `expected` jsonb
 * carries a snapshot of everything the prompt needs (the questions, the key,
 * the roster names for matching), taken when the case was made -- so a case
 * keeps meaning the same thing after the teacher edits or deletes the
 * assessment. It lives only in the private regression_cases table.
 */
import type { Assessment, Question } from "@/lib/teacher-types";

export const CASE_KINDS = ["names", "answer_reading", "grouping", "answer_key", "standards"] as const;
export type CaseKind = (typeof CASE_KINDS)[number];

/** A copied photo, as the runner reads it back from the private bucket. */
export type FixtureFile = {
  sourceUploadId: string;
  objectPath: string;
  mime: string;
  sizeBytes: number | null;
};

/** What a prompt needs of the assessment. Responses and upload lists are left
 * out: the replay grades fresh, and the pages come from the fixtures. */
export type AssessmentSnapshot = Pick<
  Assessment,
  | "id" | "classId" | "title" | "subject" | "grade" | "framework" | "createdAt" | "status"
  | "source" | "targetStandards" | "passage" | "answerKeyVerified" | "elaArea" | "genre" | "rubric"
> & { questions: Question[] };

/** One student's pile, in scan order, as the teacher confirmed it. */
export type ExpectedPile = {
  studentId: string;
  /** Whole-page upload ids (source ids; the fixture is found by them). */
  pages: string[];
  /** The name-area copy of each page, or null where none was kept. */
  strips: (string | null)[];
};

type Base = { assessment: AssessmentSnapshot; piles: ExpectedPile[] };

export type ExpectedNames = Base & {
  kind: "names";
  /** id + name of every student on the class roster when the case was made. */
  roster: { id: string; name: string }[];
  /** Whether the teacher declared the piles ("Next student") when scanning.
   * When they did not, the replay must split the stack by the names it reads,
   * as the app does -- giving it the true piles would score it on an easier
   * problem than the teacher had. Absent counts as declared. */
  pilesDeclared?: boolean;
};

/** One confirmed answer. `match` is the credit the teacher gave (0-100), or
 * null where they never decided it. */
export type ExpectedAnswer = {
  studentId: string;
  questionId: string;
  finalAnswer: string;
  answer: string;
  match: number | null;
  verified: boolean;
};

export type ExpectedAnswers = Base & {
  kind: "answer_reading" | "grouping";
  answers: ExpectedAnswer[];
};

export type ExpectedKey = {
  kind: "answer_key";
  assessment: AssessmentSnapshot;
  /** The blank worksheet's pages, read the way the assignment read reads them. */
  worksheet: string[];
  answers: { number: number; questionId: string; answer: string }[];
};

export type ExpectedStandards = {
  kind: "standards";
  assessment: AssessmentSnapshot;
  worksheet: string[];
  standards: { number: number; questionId: string; standard: string }[];
};

export type Expected = ExpectedNames | ExpectedAnswers | ExpectedKey | ExpectedStandards;

/** A case as the runner gets it from regression_cases. */
export type RegressionCase = {
  id: string;
  code: string;
  teacherId: string;
  assessmentLegacyId: string;
  kind: CaseKind;
  expected: Expected;
};
