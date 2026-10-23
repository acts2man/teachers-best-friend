import type { ElaArea, Subject } from "./teacher-types";

/**
 * The error types a teacher can tag a wrong-or-partial answer with in Grade by
 * question. Kept in ONE place, keyed by subject (and, for ELA, by area), so the
 * grading UI, the grading prompt's suggestion, the class view and the DOK grid's
 * common errors all read the same lists from errorTypesFor().
 *
 * The Math list is Ricky's, from the call on 2026-09-30. The ELA lists are
 * Michael's (Slack, 20 Oct 2026): one for reading, one for writing. ELA's
 * Language area has no list of its own yet, so it shows no error-type picker --
 * the correct behaviour until one is decided.
 */
const MATH_ERROR_TYPES = [
  "Algebraic/Arithmetic error",
  "Sign error",
  "Conceptual/Setup error",
  "Wrong formula",
  "Graph/Table interpretation error",
];

const ELA_READING_ERROR_TYPES = [
  "Main Idea / Central Idea",
  "Supporting Evidence",
  "Literal Recall / Key Details",
  "Vocabulary in Context",
  "Text Structure",
  "Author's Purpose / Point of View",
  "Connections / Relationships",
  "Summarization",
];

const ELA_WRITING_ERROR_TYPES = [
  "Weak Focus / Main Idea",
  "Insufficient Development",
  "Weak Evidence",
  "Organization",
  "Sentence Construction",
  "Grammar / Usage",
  "Punctuation / Capitalization",
  "Spelling / Word Form",
];

export const ERROR_TYPES: Record<Subject, string[]> = {
  Math: MATH_ERROR_TYPES,
  // An ELA assessment's list depends on its area (see errorTypesFor); with no
  // area it is reading comprehension, as the app has always treated it.
  ELA: ELA_READING_ERROR_TYPES,
  // A mixed assessment can hold either; the math types are offered, as before.
  Mixed: MATH_ERROR_TYPES,
};

/** Each ELA area's list. */
export const ELA_ERROR_TYPES: Record<ElaArea, string[]> = {
  reading: ELA_READING_ERROR_TYPES,
  writing: ELA_WRITING_ERROR_TYPES,
  language: [],
};

/** The error types offered for one subject (and ELA area), or [] if it has
 * none. */
export function errorTypesFor(subject: Subject, elaArea?: ElaArea): string[] {
  if (subject === "ELA") return ELA_ERROR_TYPES[elaArea ?? "reading"] ?? [];
  return ERROR_TYPES[subject] ?? [];
}

/** Every error-type name on any list: the only names a lesson request may
 * carry to the AI -- never text a student or a teacher wrote. */
export const ALL_ERROR_TYPES: readonly string[] = [
  ...new Set([...MATH_ERROR_TYPES, ...ELA_READING_ERROR_TYPES, ...ELA_WRITING_ERROR_TYPES]),
];
