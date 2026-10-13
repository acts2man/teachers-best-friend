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
export function partsAfterKeyEdit(
  q: { answerParts?: number; answer?: string },
  newKey: string,
): number | undefined {
  if (expectedParts(q) < 2) return q.answerParts;
  const raw = (k: string) => k.split(";").map((p) => p.trim()).filter(Boolean).length;
  // An edit that keeps the same ";" parts -- a typo fixed, a word changed --
  // never changes the count (#125 review, round 3: a typo fix on a 3-part
  // word answer dropped it to 2 and sent the whole class to Unsure).
  if (q.answer !== undefined && raw(q.answer) === raw(newKey)) return q.answerParts;
  const n = answerPartsInKey(newKey);
  // Never down to one answer from a key edit alone ("x = 2, y = 3" with a
  // comma): that would switch the multi-part check off without saying so.
  // The teacher sets one answer with the "Answer parts" picker.
  return n < 2 ? q.answerParts : clampParts(n);
}

/** A ";"-part of a key that is a note for the teacher, not an answer the
 * student gives: it starts with a note phrase ("accept equivalent forms",
 * "note: ...", "because ..."), or says a value is excluded/extraneous. Word
 * answers ("the lines are parallel", "equivalent") are answers. */
const NOTE = /^(accept|also accept|allow|note\b|because|or any|any equivalent|equivalent forms?\b)|\b(is|are) (excluded|extraneous)\b/i;

/** The answers a key lists, separated by ";", leaving out note parts. */
export function answerPartsInKey(key: string): number {
  return key
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p && p !== "?" && !NOTE.test(p)).length;
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
