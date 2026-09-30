import type { Assessment, ElaArea } from "./teacher-types";

/**
 * The three ELA areas, in the order Ricky and Michael chose on the Sept 28 call:
 * Reading comprehension, Writing, Language. Kept in ONE place so setup, Grade by
 * question and Class view all read the same list and labels.
 *
 * `available: false` marks an area whose grading is not built yet, so it is not
 * offered in setup even though the type and the plumbing know about it. Writing
 * (rubric-based) lands in its own change; until then the picker shows Reading
 * and Language only.
 */
export const ELA_AREAS: {
  value: ElaArea;
  label: string;
  hint: string;
  available: boolean;
}[] = [
  {
    value: "reading",
    label: "Reading comprehension",
    hint: "A story or passage plus questions, graded against an answer key.",
    available: true,
  },
  {
    value: "writing",
    label: "Writing",
    hint: "An essay scored against a rubric.",
    available: true,
  },
  {
    value: "language",
    label: "Language",
    hint: "Grammar, capitalization, punctuation, spelling, decoding and vocabulary, graded against an answer key.",
    available: true,
  },
];

/** The areas offered in setup right now (those whose grading is built). */
export function offeredElaAreas() {
  return ELA_AREAS.filter((a) => a.available);
}

/** The teacher-facing label for an area, or "" when there is none. */
export function elaAreaLabel(area?: ElaArea): string {
  return ELA_AREAS.find((a) => a.value === area)?.label ?? "";
}

/** True for an ELA writing assessment (rubric-scored rather than key-graded). */
export function isWritingAssessment(a: Pick<Assessment, "subject" | "elaArea">): boolean {
  return a.subject === "ELA" && a.elaArea === "writing";
}

/**
 * Whether a shared reading passage belongs on this assessment. Reading needs one;
 * Language does not; Writing does not. Math never did. An ELA assessment made
 * before areas existed (no elaArea) keeps the old behaviour of offering it, and a
 * passage that already exists is always shown so nothing is stranded.
 */
export function usesPassage(a: Pick<Assessment, "subject" | "elaArea" | "passage">): boolean {
  if (a.passage) return true;
  if (a.subject === "Mixed") return true;
  if (a.subject !== "ELA") return false;
  return a.elaArea === "reading" || a.elaArea === undefined;
}
