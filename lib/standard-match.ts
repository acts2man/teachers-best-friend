/**
 * Matching the standard code the AI wrote to a code in the teacher's catalog.
 *
 * The bug this fixes (12 Oct 2026): the assignment read kept the AI's first
 * choice only when it equalled a catalog code character for character, and
 * otherwise blanked it -- standard, alignment and confidence -- keeping no
 * copy. 85 of 138 questions read in the 48 hours before then came back with no
 * standard. On those same questions the AI's reasoning named catalog codes
 * ("F-IF.7 is the closest catalog standard") and its second choice was often
 * a catalog code, so the AI was choosing; the app was throwing the choice away
 * over spelling: "7.RP.A.3" (cluster letter), "HSF-IF.C.7" (high-school
 * prefix), "7.RP.2a" vs "7.RP.2.a", case and spacing.
 *
 * The rule that never bends: the result is always a code that IS in the
 * catalog, or nothing. Normalising only decides which catalog code a spelling
 * means; it never makes one up, and a code for another grade ("6.RP.A.3" in a
 * grade 7 list) still matches nothing.
 */
import type { Standard } from "./teacher-types";

export type MatchHow = "exact" | "spelling" | "parent" | "";

/**
 * A code reduced to what identifies it: upper case, no spaces, "." and "-"
 * treated alike, a leading CCSS/state prefix dropped, the high-school "HS"
 * prefix dropped ("HSF-IF" -> "F-IF"), a cluster letter dropped ("7.RP.A.3"
 * -> "7.RP.3"; only a single A-D right before the final number), and a
 * sub-part letter joined to its number ("7.RP.2.a" and "7.RP.2a" -> "7.RP.2A").
 */
export function codeKey(raw: string): string {
  let s = raw.trim().toUpperCase().replace(/\s+/g, "");
  s = s.replace(/^(CCSS\.)?(MATH\.CONTENT\.|ELA-LITERACY\.)/, "").replace(/^(CA|CCSS)[.:-]/, "");
  const parts = s.split(/[.-]/).filter(Boolean);
  if (!parts.length) return "";
  if (/^HS[AFGNS]$/.test(parts[0])) parts[0] = parts[0].slice(2);
  // A sub-part written as its own segment ("2.a" -> "2A").
  if (parts.length >= 3 && /^[A-Z]$/.test(parts[parts.length - 1]) && /\d$/.test(parts[parts.length - 2]))
    parts.splice(parts.length - 2, 2, parts[parts.length - 2] + parts[parts.length - 1]);
  // The cluster letter: one letter A-D just before a final segment that
  // starts with a digit, with a domain before it ("7.RP.A.3", "F.IF.C.7").
  // Never the grade letter in "RL.K.1": K is not A-D.
  if (parts.length >= 4 && /^[A-D]$/.test(parts[parts.length - 2]) && /^\d/.test(parts[parts.length - 1]))
    parts.splice(parts.length - 2, 1);
  return parts.join(".");
}

/** The parent of a sub-part key ("F.IF.7E" -> "F.IF.7"), or "". */
function parentKey(key: string): string {
  const m = key.match(/^(.*\.\d+)[A-Z]$/);
  return m ? m[1] : "";
}

/**
 * The catalog code the AI meant by `raw`, and how it was found:
 *   "exact"    -- written exactly as in the catalog;
 *   "spelling" -- the same code written differently (see codeKey);
 *   "parent"   -- a sub-part the catalog does not list ("F-IF.7e"), whose
 *                 parent it does ("F-IF.7");
 *   ""         -- no catalog code, or more than one it could be.
 */
export function matchCatalogCode(raw: string, catalog: Pick<Standard, "code">[]): { code: string; how: MatchHow } {
  const wrote = (raw ?? "").trim();
  if (!wrote) return { code: "", how: "" };
  const exact = catalog.find((s) => s.code === wrote);
  if (exact) return { code: exact.code, how: "exact" };
  const byKey = new Map<string, string[]>();
  for (const s of catalog) {
    const k = codeKey(s.code);
    if (k) byKey.set(k, [...(byKey.get(k) ?? []), s.code]);
  }
  // Several catalog entries can share a key only by spelling the same
  // standard two ways ("7.RP.2a" in one list, "7.RP.2.a" in another); they
  // are one standard, so the first is used.
  const key = codeKey(wrote);
  const hit = byKey.get(key);
  if (hit?.length) return { code: hit[0], how: "spelling" };
  const parent = parentKey(key);
  const up = parent ? byKey.get(parent) : undefined;
  if (up?.length) return { code: up[0], how: "parent" };
  return { code: "", how: "" };
}

/** What happened to one question's standard, kept with the read (48 hours,
 * server side) so a miss can be checked instead of guessed at. */
export type StandardMatchRecord = {
  number: number;
  wrote: string;
  secondaryWrote: string;
  used: string;
  how: MatchHow | "second-choice";
};

type ReadQuestion = {
  number: number;
  standard: string;
  secondary: string;
  alignment: number;
  confidence: number;
  reasoning: string;
};

/**
 * Settles every question's standard against the catalog:
 *   1. the AI's first choice, matched (exact, spelling or parent);
 *   2. else its second choice, matched the same way -- marked as such: its
 *      alignment is capped at 60 (the AI's score was for its first choice, so
 *      this one is never shown as a strong, green fit), confidence at 50, and
 *      the reasoning says it is the second choice, to check;
 *   3. else no standard, and the reasoning says what the AI wrote that is not
 *      in the teacher's list.
 * The second choice keeps only a catalog code, as before.
 */
export function settleStandards<Q extends ReadQuestion>(
  questions: Q[],
  catalog: Pick<Standard, "code">[],
): { questions: Q[]; records: StandardMatchRecord[] } {
  const records: StandardMatchRecord[] = [];
  const out = questions.map((q) => {
    const first = matchCatalogCode(q.standard, catalog);
    const second = matchCatalogCode(q.secondary, catalog);
    const record = { number: q.number, wrote: q.standard ?? "", secondaryWrote: q.secondary ?? "" };
    const secondary = second.code && second.code !== first.code ? second.code : "";
    if (first.code) {
      records.push({ ...record, used: first.code, how: first.how });
      return { ...q, standard: first.code, secondary };
    }
    if (second.code) {
      records.push({ ...record, used: second.code, how: "second-choice" });
      const note = q.standard.trim()
        ? `The AI's first choice (${q.standard.trim()}) isn't in your standards list; this is its second choice — check it. `
        : "The AI gave no first choice from your standards list; this is its second choice — check it. ";
      return {
        ...q,
        standard: second.code,
        secondary: "",
        alignment: Math.min(q.alignment > 0 ? q.alignment : 50, 60),
        confidence: Math.min(q.confidence, 50),
        reasoning: note + q.reasoning,
      };
    }
    records.push({ ...record, used: "", how: "" });
    const note = q.standard.trim()
      ? `The AI suggested ${q.standard.trim()}, which isn't in your standards list — choose one. `
      : "";
    return { ...q, standard: "", secondary: "", alignment: 0, confidence: 0, reasoning: note + q.reasoning };
  });
  return { questions: out, records };
}
