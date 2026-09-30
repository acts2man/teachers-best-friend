import type { Subject } from "./teacher-types";

/**
 * The error types a teacher can tag a wrong-or-partial answer with in Grade by
 * question. Kept in ONE place, keyed by subject, so ELA (and any other subject)
 * can get its own list here later without touching the grading UI or the class
 * view -- both read from errorTypesFor().
 *
 * The Math list is Ricky's, from the call on 2026-09-30. ELA is intentionally
 * empty until its types are decided on a later call: a subject with no list
 * simply shows no error-type picker, which is the correct behaviour until then.
 */
const MATH_ERROR_TYPES = [
  "Algebraic/Arithmetic error",
  "Sign error",
  "Conceptual/Setup error",
  "Wrong formula",
  "Graph/Table interpretation error",
];

export const ERROR_TYPES: Record<Subject, string[]> = {
  Math: MATH_ERROR_TYPES,
  ELA: [],
  // A mixed assessment can hold either; until ELA has its own list, the math
  // types are the only ones there are, so a mixed set offers those.
  Mixed: MATH_ERROR_TYPES,
};

/** The error types offered for one subject, or [] if that subject has none. */
export function errorTypesFor(subject: Subject): string[] {
  return ERROR_TYPES[subject] ?? [];
}
