/**
 * Matching the standard code the AI wrote to a code in the teacher's catalog.
 *
 * The bug this fixes (12 Oct 2026): the assignment read kept the AI's first
 * choice only when it equalled a catalog code character for character, and
 * otherwise blanked it -- standard, alignment and confidence -- keeping no
 * copy. 85 of 138 questions read in the 48 hours before then came back with no
 * standard. On those same questions the AI's written reasoning named catalog
 * codes ("F-IF.7 is the closest catalog standard" -- read on production on
 * 12 Oct; the reasoning is not kept in the test fixture) and its second choice
 * was often a catalog code, so the AI was choosing and the app was throwing
 * the choice away. Why the exact match failed was never recorded; the likely
 * spellings are handled here ("7.RP.A.3", "HSF-IF.C.7", "7.RP.2a" vs
 * "7.RP.2.a", case and spacing), and standardMatches now records the truth.
 *
 * The rule that never bends: the result is always a code that IS in the
 * catalog, or nothing. Normalising only decides which catalog code a spelling
 * means; it never makes one up, and a code for another grade ("6.RP.A.3" in a
 * grade 7 list) still matches nothing.
 */
import type { Standard } from "./teacher-types";

export type MatchHow = "exact" | "spelling" | "parent" | "titled" | "";

/**
 * A code reduced to what identifies it: upper case, no spaces, "." and "-"
 * treated alike, a leading CCSS/state prefix dropped, the high-school "HS"
 * prefix dropped ("HSF-IF" -> "F-IF"), a cluster letter dropped ("7.RP.A.3"
 * -> "7.RP.3"; only a single A-D right before the final number), and a
 * sub-part letter joined to its number ("7.RP.2.a" and "7.RP.2a" -> "7.RP.2A").
 */
export function codeKey(raw: string): string {
  // Spaces separate, like "." and "-": "7 RP 3" is 7.RP.3.
  let s = raw.trim().toUpperCase().replace(/\s+/g, ".");
  s = s.replace(/^(CCSS\.)?(MATH\.CONTENT\.|ELA-LITERACY\.)/, "").replace(/^(CA|CCSS)[.:-]/, "");
  const parts = s.split(/[.-]/).filter(Boolean);
  if (!parts.length) return "";
  if (/^HS[AFGNS]$/.test(parts[0])) parts[0] = parts[0].slice(2);
  // A sub-part written as its own segment ("2.a" -> "2A").
  if (parts.length >= 3 && /^[A-Z]$/.test(parts[parts.length - 1]) && /\d$/.test(parts[parts.length - 2]))
    parts.splice(parts.length - 2, 2, parts[parts.length - 2] + parts[parts.length - 1]);
  // The cluster letter: one letter A-D right after the domain, before a
  // number ("7.RP.A.3", "F.IF.C.7", "G.SRT.C.8.1"). Never the grade letter in
  // "RL.K.1": it is the second segment, and K is not A-D.
  for (let i = parts.length - 2; i >= 2; i--)
    if (/^[A-D]$/.test(parts[i]) && /^\d/.test(parts[i + 1]) && /^[A-Z]+$/.test(parts[i - 1])) parts.splice(i, 1);
  return parts.join(".");
}

/** The parent of a sub-part key ("F.IF.7E" -> "F.IF.7"), or "". */
function parentKey(key: string): string {
  const m = key.match(/^(.*\.\d+)[A-Z]$/);
  return m ? m[1] : "";
}

/** Where a title can start after a code: " — ", " – " (spaces optional
 * around a dash, which never appears inside a code), " - ", ": " or " (". */
const TITLE_START = /\s*[—–]\s*|\s+-\s+|:\s+|\s+\(/g;

/**
 * The code, when the AI writes it with its title after it:
 * "F-IF.7 — Graph Functions and Key Features" -> "F-IF.7" (Ricky, 14 Oct
 * 2026: codeKey read the title's words as more code segments, and 10 of 10
 * first choices in his two reads on 15 Oct matched nothing).
 *
 * Every text BEFORE a possible title start, longest first -- a custom or
 * state code can itself contain one ("4.4 (D)", "Unit 3 - Fractions"), and
 * the longest catalog code that fits is the one meant. Only a beginning is
 * ever tried, never what follows, so a title can never be what matches.
 */
export function codeParts(raw: string): string[] {
  const s = (raw ?? "").trim();
  const cuts: string[] = [];
  for (const m of s.matchAll(TITLE_START)) if (m.index) cuts.push(s.slice(0, m.index).trim());
  return [...new Set(cuts.reverse())].filter(Boolean);
}

/** A sub-part letter written in brackets, joined on: "F-IF.7 (e)" -> "F-IF.7e". */
const joinSubPart = (code: string) => code.replace(/^(.*\d)\s*\(([a-z])\)$/i, "$1$2");

/**
 * The catalog code the AI meant by `raw`, and how it was found:
 *   "exact"    -- written exactly as in the catalog;
 *   "spelling" -- the same code written differently (see codeKey);
 *   "parent"   -- a sub-part the catalog does not list ("F-IF.7e"), whose
 *                 parent it does ("F-IF.7");
 *   "titled"   -- the code with more after it: a title ("F-IF.7 — Graph
 *                 Functions") or a bracketed sub-part ("F-IF.7 (e)"), kept
 *                 apart so standardMatches shows whether the read still adds
 *                 titles;
 *   ""         -- no catalog code, or more than one it could be.
 */
export function matchCatalogCode(raw: string, catalog: Pick<Standard, "code">[]): { code: string; how: MatchHow } {
  const whole = matchWritten(raw, catalog);
  if (whole.code && whole.how !== "parent") return whole;
  // What the AI wrote as the code: the whole text with a bracketed sub-part
  // joined, then each beginning before a possible title, longest first (each
  // with its sub-part joined too). A real match (exact or spelling) anywhere
  // beats a parent, so "4.4 (D) — compute" is "4.4 (D)", not the "4.4" a
  // "4.4D" would fall back to.
  const tries = [joinSubPart((raw ?? "").trim()), ...codeParts(raw).flatMap((p) => [joinSubPart(p), p])];
  let parent = whole.code ? whole : null;
  for (const t of [...new Set(tries)]) {
    const hit = matchWritten(t, catalog);
    if (!hit.code) continue;
    if (hit.how !== "parent") return { code: hit.code, how: t === (raw ?? "").trim() ? hit.how : "titled" };
    parent ??= hit;
  }
  return parent ?? { code: "", how: "" };
}

function matchWritten(raw: string, catalog: Pick<Standard, "code">[]): { code: string; how: MatchHow } {
  const wrote = (raw ?? "").trim();
  if (!wrote) return { code: "", how: "" };
  const exact = catalog.find((s) => s.code === wrote);
  if (exact) return { code: exact.code, how: "exact" };
  const byKey = new Map<string, string[]>();
  for (const s of catalog) {
    const k = codeKey(s.code);
    if (k) byKey.set(k, [...(byKey.get(k) ?? []), s.code]);
  }
  const key = codeKey(wrote);
  const bare = (c: string) => c.toUpperCase().replace(/[\s.-]/g, "");
  const one = (codes: string[] | undefined) => {
    if (!codes?.length) return "";
    // Several catalog entries can share a key by spelling ONE standard two
    // ways ("7.RP.2a" in one list, "7.RP.2.a" in another): same characters
    // apart from separators and case. Anything else sharing a key (a custom
    // "HSS.7.1" beside "S.7.1") may be two standards: then neither.
    if (new Set(codes.map(bare)).size === 1) return codes[0];
    // Unless one of them is what the AI wrote, but for separators and case.
    return codes.find((c) => bare(c) === bare(wrote)) ?? "";
  };
  const hit = byKey.get(key);
  if (hit?.length) {
    const code = one(hit);
    return code ? { code, how: "spelling" } : { code: "", how: "" };
  }
  const parent = parentKey(key);
  const up = one(parent ? byKey.get(parent) : undefined);
  if (up) return { code: up, how: "parent" };
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
  level?: string;
};

/** How the notes this module adds to `reasoning` begin. They are for the
 * teacher while choosing a standard, and are taken out once they have
 * (see withoutStandardNote). */
export const SECOND_CHOICE_NOTE = "[AI's second choice — check it] ";
export const NOT_IN_LIST_NOTE = "[Not in your standards list] ";

/** The question's standard is the AI's second choice, not yet checked. Its
 * own field decides: a teacher can edit the reasoning's note away and it still
 * counts (#129 round 3). The note also counts, so the mark fails safe if the
 * field is ever lost -- e.g. code deployed before migration 20261013130000,
 * whose save would drop it and show the guess as "You chose it". Confirming a
 * question clears both (confirmQuestion). */
export function isSecondChoice(q: { secondChoice?: boolean; reasoning?: string }): boolean {
  return q.secondChoice === true || (q.reasoning ?? "").startsWith(SECOND_CHOICE_NOTE);
}

/** `reasoning` without a note this module added: what the AI said about the
 * question, as before. */
export function withoutStandardNote(reasoning: string): string {
  for (const marker of [SECOND_CHOICE_NOTE, NOT_IN_LIST_NOTE])
    if (reasoning.startsWith(marker)) {
      const end = reasoning.indexOf(" ¶ ");
      // The separator gone (the teacher edited the text): take off only the
      // marker, never their words.
      return end >= 0 ? reasoning.slice(end + 3) : reasoning.slice(marker.length);
    }
  return reasoning;
}

const shown = (code: string) => code.replace(/¶/g, "").trim().slice(0, 40);

/**
 * Settles every question's standard against the catalog:
 *   1. the AI's first choice, matched (exact, spelling or parent);
 *   2. else its second choice, matched the same way -- marked as such
 *      (secondChoice): no alignment score, because the AI's score was for its
 *      first choice and inventing one put guesses in the average (#129 round
 *      3: the old code showed 15% on Ricky's c2e875b2, where 3 of 10 matched his
 *      tags); confidence
 *      capped at 50; and a note in the reasoning saying why;
 *   3. else no standard, and the reasoning says what the AI wrote that is not
 *      in the teacher's list.
 * The second choice keeps only a catalog code, as before.
 */
export function settleStandards<Q extends ReadQuestion>(
  questions: Q[],
  catalog: Pick<Standard, "code">[],
): { questions: (Q & { secondChoice?: boolean })[]; records: StandardMatchRecord[] } {
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
    // The second choice stands in only for a first choice the AI DID give that
    // is not in the list. An empty first choice is the AI saying the question
    // fits no standard (the prompt allows empty only then), and "Unrelated"
    // says the same: neither is overruled by a runner-up.
    if (second.code && q.standard.trim() && q.level !== "Unrelated") {
      records.push({ ...record, used: second.code, how: "second-choice" });
      const note = `${SECOND_CHOICE_NOTE}The AI's first choice (${shown(q.standard)}) isn't in your standards list; this is its second choice. ¶ `;
      return {
        ...q,
        standard: second.code,
        secondary: "",
        secondChoice: true,
        alignment: 0,
        confidence: Math.min(q.confidence, 50),
        reasoning: note + q.reasoning,
      };
    }
    records.push({ ...record, used: "", how: "" });
    // Kept as the question's secondary, so the teacher still sees it.
    const keptSecond = second.code;
    const note = q.standard.trim()
      ? `${NOT_IN_LIST_NOTE}The AI suggested ${shown(q.standard)}, which isn't in your standards list — choose one. ¶ `
      : "";
    return { ...q, standard: "", secondary: keptSecond, alignment: 0, confidence: 0, reasoning: note + q.reasoning };
  });
  return { questions: out, records };
}
