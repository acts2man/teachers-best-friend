/** Multi-part questions: how many answers a question asks for, and how many a
 * read actually returned. Its own module so the prompt builder, the class scan
 * and the response normaliser can all use it without importing each other. */

/**
 * How many separate answers a question asks for: its `answerParts`, set by the
 * worksheet read (Ricky's idea, 12 Oct 2026). Absent means one. It is NOT
 * inferred from ";" in the key: 34 of 176 confirmed keys on 12 Oct used ";" for
 * other things ("x = 15/2; x = 5 is excluded", "B; because...") and would have
 * sent every student on those questions to Unsure.
 */
export function expectedParts(q: { answerParts?: number }): number {
  const n = Number(q.answerParts);
  return Number.isInteger(n) && n > 1 ? Math.min(n, 20) : 1;
}

/** The parts actually read in a final answer: "?" marks a part not found. */
export function partsRead(final: string): number {
  return final
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p && p !== "?").length;
}


/**
 * The question's answerParts after the teacher edits its key (#125 review). A
 * multi-part question follows its key: a key edited to "x=2; y=3; z=1" asks for
 * 3. A single-answer question is NOT made multi-part by a ";" in its key -- a
 * ";" is often a note ("x = 15/2; x = 5 is excluded") -- the teacher sets that
 * with the "Answer parts" box instead. Undefined means one answer.
 */
export function partsAfterKeyEdit(q: { answerParts?: number }, newKey: string): number | undefined {
  if (expectedParts(q) < 2) return q.answerParts;
  return clampParts(answerPartsInKey(newKey));
}

/** Words that mark a ";"-part of a key as a note for the teacher, not an
 * answer the student gives ("x = 2; y = 3; accept equivalent forms"). */
const NOTE = /\b(accept|accepts|accepted|because|excluded|extraneous|equivalent|note|or any|also ok|allow|ignore)\b/i;

/**
 * The answers a key lists, separated by ";", leaving out the parts that are
 * notes: a part with a note word in it, or one of three or more words with
 * no number, "=" or math in it ("full sentence required"). A one-word part
 * ("B") stays an answer, so a multiple-choice "B; D" is two.
 */
export function answerPartsInKey(key: string): number {
  return key
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p && p !== "?")
    .filter((p) => !NOTE.test(p))
    .filter((p) => /[\d=<>≤≥()^/+*-]/.test(p) || p.split(/\s+/).length < 3).length;
}

/** A parts count as stored: 2-20, or undefined for a single answer. Same
 * bounds the database keeps (it clamps rather than rejecting the save). */
export function clampParts(n: unknown): number | undefined {
  const v = Math.trunc(Number(n));
  if (!Number.isFinite(v) || v < 2) return undefined;
  return Math.min(v, 20);
}

/** A copy of `q` with answerParts set to `n`, or without it when `n` is
 * undefined (one answer) -- never a stored `answerParts: undefined`. */
export function withParts<T extends { answerParts?: number }>(q: T, n: number | undefined): T {
  const next = { ...q };
  if (n) next.answerParts = n;
  else delete next.answerParts;
  return next;
}
