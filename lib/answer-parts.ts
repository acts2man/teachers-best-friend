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

