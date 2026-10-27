import type { ElaArea, Subject } from "./teacher-types";

/**
 * The error types a teacher can tag a wrong-or-partial answer with in Grade by
 * question. Kept in ONE place, keyed by subject (and, for ELA, by area), so the
 * grading UI, the grading prompt's suggestion, the class view and the DOK grid's
 * common errors all read the same lists from errorTypesFor().
 *
 * The Math list is Ricky's (Slack, 24 Oct 2026; it replaced his 30 Sep list --
 * the old tags were copied to student_responses.legacy_error_type and cleared,
 * migration 20261027120000). Its last entry, "Other", lets the teacher type
 * their own label (otherErrorLabel). The ELA lists are
 * Michael's (Slack, 20 Oct 2026): one for reading, one for writing. ELA's
 * Language area has no list of its own yet, so it shows no error-type picker --
 * the correct behaviour until one is decided.
 */
/** The list entry whose label the teacher types themselves. */
export const OTHER_ERROR_TYPE = "Other";
/** How a typed label is stored: "Other: <what the teacher typed>". */
const OTHER_PREFIX = OTHER_ERROR_TYPE + ": ";
/** A typed label is short: it names a mistake, it does not describe one. */
export const OTHER_LABEL_MAX = 60;

const MATH_ERROR_TYPES = [
  "Conceptual Gap",
  "Setup/Method Error",
  "Algebraic/Procedural Error",
  "Sign Error",
  "Graphing Error",
  "Data Interpretation Error",
  "Reasoning/Justification Error",
  OTHER_ERROR_TYPE,
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

/** The stored error type for "Other" with the teacher's own label: trimmed,
 * one line, at most OTHER_LABEL_MAX characters; plain "Other" when empty. */
export function otherErrorLabel(text: string): string {
  const typed = text.replace(/\s+/g, " ").trim().slice(0, OTHER_LABEL_MAX).trim();
  return typed ? OTHER_PREFIX + typed : OTHER_ERROR_TYPE;
}

/** Whether a stored error type is "Other", with or without a typed label. */
export function isOtherErrorType(errorType: string): boolean {
  return errorType === OTHER_ERROR_TYPE || errorType.startsWith(OTHER_PREFIX);
}

/** The label the teacher typed for "Other" ("" when none, or not Other). */
export function otherErrorText(errorType: string): string {
  return errorType.startsWith(OTHER_PREFIX) ? errorType.slice(OTHER_PREFIX.length) : "";
}

/** Whether a stored error type belongs to `types`: on it, or a typed "Other"
 * label when the list has "Other". A tag from a list since replaced is not. */
export function onErrorList(types: readonly string[], errorType: string): boolean {
  if (types.includes(errorType)) return true;
  return types.includes(OTHER_ERROR_TYPE) && isOtherErrorType(errorType);
}

/** The types the grading AI may suggest: the list without "Other" -- a
 * suggestion with no label would only make the teacher type one. */
export function suggestableErrorTypes(subject: Subject, elaArea?: ElaArea): string[] {
  return errorTypesFor(subject, elaArea).filter((t) => t !== OTHER_ERROR_TYPE);
}

/** An error type as it may reach the AI: a typed "Other" label is only
 * "Other" -- the teacher's words never leave the app. */
export function errorTypeForAi(errorType: string): string {
  return isOtherErrorType(errorType) ? OTHER_ERROR_TYPE : errorType;
}

/** Every error-type name on any list: the only names a lesson request may
 * carry to the AI -- never text a student or a teacher wrote ("Other" is on
 * it; what a teacher typed after "Other: " is not). */
export const ALL_ERROR_TYPES: readonly string[] = [
  ...new Set([...MATH_ERROR_TYPES, ...ELA_READING_ERROR_TYPES, ...ELA_WRITING_ERROR_TYPES]),
];
