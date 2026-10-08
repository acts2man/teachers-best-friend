export type Subject = "Math" | "ELA" | "Mixed";
/** The three ELA areas a teacher picks from when the subject is ELA. Reading and
 * Language grade against an answer key (the same match/blank/other verdicts as
 * Math); Writing is scored against a rubric. See lib/ela.ts. */
export type ElaArea = "reading" | "writing" | "language";
export type Standard = {
  code: string;
  title: string;
  subject: Subject;
  grade: number;
  domain: string;
  cluster: string;
  summary: string;
  skills: string[];
  prerequisites: string[];
  next: string[];
  vocabulary: string[];
  misconception: string;
  example: string;
  dok: number;
  source: string;
  framework: string;
  wording?: string;
  officialCode?: string;
};
export type Evidence = {
  id: string;
  standard: string;
  score: number;
  date: string;
  source: string;
  assessmentId?: string;
};
export type Student = {
  id: string;
  classId: string;
  name: string;
  color: string;
  evidence: Evidence[];
  notes: string;
};
export type Question = {
  id: string;
  number: number;
  text: string;
  passage: string;
  answer: string;
  standard: string;
  secondary: string;
  skill: string;
  dok: number;
  costas?: 1 | 2 | 3;
  alignment: number;
  improvement?: string;
  confidence: number;
  level: "On grade" | "Below grade" | "Above grade" | "Unrelated";
  reasoning: string;
  verified: boolean;
  excluded: boolean;
  /** What this question is worth, set by the teacher. Absent means the
   * assessment's total split evenly, or 1 (see questionPoints). */
  points?: number;
  /**
   * A second, independent solve of an answer the APP worked out (no teacher
   * key uploaded). "differs" means the two solves disagree and the teacher has
   * not yet settled it -- the key cannot be confirmed until they do.
   * "resolved" is a disagreement the teacher settled. Absent when the key came
   * from the teacher or was never checked. See lib/key-check.ts.
   */
  keyCheck?: KeyCheck;
};
export type KeyCheck = {
  /** The checker's own answer for this question ("" when it could not tell). */
  answer: string;
  status: "agrees" | "differs" | "resolved";
};
export type StudentResponse = {
  id: string;
  studentId: string;
  questionId: string;
  answer: string;
  correct: boolean;
  match?: number;
  misconception: string;
  confidence: number;
  verified: boolean;
  /** An optional teacher-chosen error type for a wrong-or-partial answer, set in
   * Grade by question. One per answer group; empty/absent means untagged. See
   * lib/error-types.ts for the list. */
  errorType?: string;
  /** Writing only: the raw rubric level the teacher confirmed for this dimension
   * (0..dimension.max). `match` still carries the percentage (score/max*100) so
   * mastery and the gradebook read it the same as any other response; this keeps
   * the level the teacher actually sees ("3 of 4"). */
  rubricScore?: number;
  /** Writing only: the AI's one-line reason, tied to the student's writing, for
   * the level it suggested. Shown beside the score for the teacher to weigh. */
  rubricReason?: string;
  /**
   * The student's final answer alone, as the grading pass read it -- the
   * number, choice or value with working and units stripped ("11163" for
   * "5,753 + 2,250 + 3,160 = 11,163 people"). Grade by question groups on this,
   * so students who reached the same answer by writing it differently land in
   * one group. Absent on answers graded before it existed.
   */
  finalAnswer?: string;
  /** Roughly where on which scanned page this answer sits, as fractions of the
   * page, so Grade by question can show a cropped photo of just this answer. */
  answerRegion?: AnswerRegion;
  /** The error type the grading pass suggests for a wrong answer, from the
   * subject's list. Only a suggestion: the teacher approves or changes it, and
   * it is not `errorType` until they do. */
  suggestedErrorType?: string;
};
export type AnswerRegion = {
  uploadId: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
/** One row of a writing rubric: a trait scored 0..max with a descriptor the
 * teacher can edit, and the standard its scores count toward for mastery. */
export type RubricDimension = {
  id: string;
  name: string;
  max: number;
  descriptor: string;
  standard: string;
};
export type Assessment = {
  id: string;
  classId: string;
  title: string;
  subject: Subject;
  /** For ELA assessments, which of the three areas this is. Absent on Math and
   * on ELA assessments made before areas existed -- those keep working as the
   * answer-key flow they already were. */
  elaArea?: ElaArea;
  grade: number;
  framework: string;
  createdAt: string;
  status: "Ready" | "Needs review" | "Draft";
  questions: Question[];
  responses: StudentResponse[];
  uploadIds: string[];
  source: "sample" | "manual" | "ai";
  passage?: string;
  /** Writing only: the genre being scored. Picks the default rubric. */
  genre?: "informational" | "narrative" | "response";
  /** Writing only: the rubric the AI scores against and the teacher can edit.
   * Absent on every non-writing assessment. */
  rubric?: RubricDimension[];
  targetStandards: string[];
  answerKeyUploadIds?: string[];
  assignmentUploadIds?: string[];
  studentUploadIds?: Record<string, string[]>;
  answerKeyVerified?: boolean;
  classIds?: string[];
  // What the whole assessment is worth, if the teacher sets it (e.g. 20). When
  // present, a whole-test score is shown both ways: the percentage and points
  // out of this total. Optional -- absent means percentage only, as before.
  pointsPossible?: number;
  /** Student ids in the order their work was scanned, so the matching screen,
   * the review list and Grade by question follow the pile on the teacher's
   * desk. Absent until a class scan is saved. */
  studentOrder?: string[];
};
export type Classroom = {
  id: string;
  name: string;
  grade: number;
  framework: string;
  demo: boolean;
};
export type Lesson = {
  id: string;
  classId: string;
  standard: string;
  title: string;
  duration: number;
  modality: string;
  notes: string;
  date: string;
  completed: boolean;
  studentIds: string[];
  origin: "template" | "ai" | "edited";
  framework?: string;
  grade?: number;
  assessmentId?: string;
  custom?: {
    objective: string;
    materials: string[];
    phases: { time: string; name: string; text: string }[];
    practice: { q: string; a: string }[];
    exit: { q: string; a: string }[];
  };
};
export type Resource = {
  id: string;
  title: string;
  category: string;
  standard: string;
  content: string;
  uploadId?: string;
  pages?: string;
  classId?: string;
};
export type Group = {
  id: string;
  classId: string;
  name: string;
  standard: string;
  studentIds: string[];
};
export type Workspace = {
  classes: Classroom[];
  activeClassId: string;
  students: Student[];
  assessments: Assessment[];
  lessons: Lesson[];
  resources: Resource[];
  customStandards: Standard[];
  // Read-only: standards an admin has unlocked for every teacher (see
  // app/admin/standards). Never written back by sync_workspace — a
  // teacher's own saves only ever touch customStandards.
  sharedStandards: Standard[];
  groups: Group[];
  settings: {
    teacherName: string;
    school: string;
    reduceMotion: boolean;
    theme?: string;
  };
};
export type Priority = {
  standard: Standard;
  students: Student[];
  mastery: number;
  score: number;
  tier: string;
};
