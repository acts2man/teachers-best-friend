/**
 * The name the class-set grading pass says it read on a pile, cleaned for the
 * app's check (lib/answer-mixups.ts) -- or "" when it is not a name at all
 * (review of #203): no letters ("?", "—", "123"), or a placeholder the model
 * writes for nothing legible ("unreadable", "illegible", "Name:", "n/a",
 * "none", "unknown", "no name", "blank"). Blank is "no evidence": it never
 * flags a student.
 */
const PLACEHOLDERS = new Set([
  "unreadable", "illegible", "name", "n/a", "na", "none", "unknown", "no name", "noname", "blank",
  "not legible", "cannot read", "can't read", "no name written", "nameless", "student", "student name",
]);

export function usableNameSeen(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const name = raw.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!/\p{L}/u.test(name)) return "";
  const bare = name.toLowerCase().replace(/[\s:.\-_()[\]?!*"'“”‘’]+/g, " ").trim();
  if (PLACEHOLDERS.has(bare) || PLACEHOLDERS.has(bare.replace(/\s+/g, ""))) return "";
  if (/^\[?(unreadable|illegible)\b/.test(bare)) return "";
  return name;
}

/**
 * A class-set grading result as it is KEPT (scans.result, the delivery
 * buffer): without the names read on the piles. The teacher's own phone gets
 * them once, in the reply that finishes the job, and turns them at once into
 * which roster students each could be (lib/answer-mixups.ts seenFitsFor);
 * the name itself is never stored (review of #203). A resume that reads the
 * stored result back simply has no name to check.
 */
export function withoutNameSeen<T extends Record<string, unknown>>(output: T): T {
  const groups = (output as { groups?: unknown }).groups;
  if (!Array.isArray(groups)) return output;
  return {
    ...output,
    groups: groups.map((g) => {
      if (!g || typeof g !== "object" || !("nameSeen" in g)) return g;
      const { nameSeen: _drop, ...rest } = g as Record<string, unknown>;
      void _drop;
      return rest;
    }),
  };
}
