/**
 * Whether a replay got an answer RIGHT, as opposed to whether it spelled it
 * the way the teacher did. Used only to score regression replays; it never
 * grades a student or checks a key in the app.
 *
 * The first real run (13 Oct) failed reads and key answers that were right:
 * "x=79" against "x = 79", an added "domain=" label, a Unicode minus, a
 * computation chain against its bare result, a full description against the
 * teacher's short final answer, a two-part answer with one part kept. This
 * normalises those away and then compares each part with the same code
 * grading uses (compareAnswers / sameReading in lib/math-answer.ts), which is
 * not edited: everything here only feeds it.
 *
 * What keeps it from going soft (#review of this file):
 *   - no rounding tolerance: 3577.55 and 3577.56 differ, and two exact values
 *     that round alike ("22/7 ≈ 3.14", "π ≈ 3.14") differ;
 *   - prose is never fed to compareAnswers, which cuts text at "is"/"for":
 *     two different sentences are a human check, not "the same", and two
 *     sentences with different numbers in them are different;
 *   - an answer with several solutions ("x=5 or x=-5") is compared item by
 *     item, never cut down to its last value;
 *   - an extra VALUE in a read ("-5; 5" for "5") is wrong; only extra
 *     description is allowed;
 *   - labels that carry meaning are compared when both sides have one:
 *     "max" against "min", "P(5)" against "P(6)". A bare variable or function
 *     name is not ("A(t)=" and "P(t)=" are the same model);
 *   - units: when both sides name units, they must name the same ones.
 */
import { compareAnswers, sameReading } from "@/lib/math-answer";

export type ReadVerdict =
  /** Equal once normalised, part by part. */
  | "same"
  /** Every part the read has matches an expected part, in order, but some
   * expected parts are missing. A faithful, incomplete read. */
  | "parts_missing"
  /** Not shown equal, and prose (a description, a sketch) is involved with
   * the same numbers on both sides: a person should look. Not a miss. */
  | "needs_human_check"
  | "different";

/** Words that are maths, not prose and not units. */
const MATH_WORDS = new Set(["ln", "log", "sqrt", "sin", "cos", "tan", "pi", "exp", "e"]);
/** Small words that never count as units or prose on their own. */
const STOP = new Set(["or", "and", "is", "the", "of", "to", "at", "for", "a", "an", "on", "by", "with", "about", "approximately", "approx"]);
const UNIT_ALIASES: Record<string, string> = {
  yr: "year", yrs: "year", hr: "hour", hrs: "hour", min: "minute", mins: "minute", sec: "second", secs: "second",
  ft: "foot", feet: "foot", inches: "inch", "in": "inch",
};
const unitName = (w: string) => {
  const lower = w.toLowerCase();
  const alias = UNIT_ALIASES[lower];
  if (alias) return alias;
  return lower.length > 2 ? lower.replace(/s$/, "") : lower;
};

/** Characters that mean the same thing, money and thousands separators gone. */
function tidy(raw: string): string {
  return (
    raw
      .normalize("NFKC")
      .replace(/[−‒–—‐﹣－]/g, "-")
      .replace(/≅|~=|≈/g, "≈")
      .replace(/\$/g, "")
      // "3,577.55", "2,406,118.05": a thousands separator, not a list --
      // except right after an opening bracket or a comma, where "(0,100)" and
      // "(1,000, 2)" are pairs.
      .replace(/(^|[^(\[,\d.])(\d{1,3}(?:,\d{3})+)(?![\d,])/g, (_, pre: string, n: string) => pre + n.replace(/,/g, ""))
      .trim()
  );
}

/** A unit is a word straight after a number or ")": "12.6 years",
 * "2log_2(10) hours". Singular, lower case, common abbreviations spelled out. */
export function unitsIn(raw: string): Set<string> {
  const out = new Set<string>();
  for (const m of tidy(raw).matchAll(/(?:\d|\))\s*([a-zA-Z]{2,})\b/g)) {
    const w = m[1].toLowerCase();
    if (MATH_WORDS.has(w) || (STOP.has(w) && !(w in UNIT_ALIASES))) continue;
    out.add(unitName(w));
  }
  return out;
}

/** Prose: three or more words that are neither maths, units nor small words. */
export function isProse(raw: string): boolean {
  const units = unitsIn(raw);
  const words = (tidy(raw).toLowerCase().match(/[a-z]{3,}/g) ?? []).filter(
    (w) => !MATH_WORDS.has(w) && !STOP.has(w) && !units.has(unitName(w)),
  );
  return words.length >= 3;
}

/** Any word that is not maths, a unit or a small word: text, not a value. */
function hasWords(raw: string): boolean {
  const units = unitsIn(raw);
  return (tidy(raw).toLowerCase().match(/[a-z]{3,}/g) ?? []).some(
    (w) => !MATH_WORDS.has(w) && !STOP.has(w) && !units.has(unitName(w)),
  );
}

/** The numbers written in an answer, as a set: what two descriptions must
 * agree on before a person is asked to compare them. */
function numbersIn(raw: string): string {
  const ns = (tidy(raw).match(/-?\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n)));
  return [...new Set(ns)].sort().join(" ");
}

// A label in front of an answer: "x", "A(t)", "P(5)", or a phrase with a real
// word in it -- "domain", "horizontal asymptote", "y-intercept". Not "x - y"
// or "x-y" (expressions: a phrase needs a word of two letters or more) and not
// anything starting with a digit.
const LABEL =
  /^([a-z][a-z0-9_]*)(\([^()]*\))?\s*([=:≈])\s*(?=\S)|^((?=[a-z0-9_ -]*[a-z]{2})[a-z][a-z0-9_]*(?:[ -][a-z][a-z0-9_]*)+)\s*([=:])\s*(?=\S)/i;

/** Labels that carry meaning, by what they mean: "y-int" and "y-intercept",
 * "asymptote" and "horizontal asymptote" are the same label. Any other word
 * ("answer", "solution", "total") is not compared. */
function meaningOf(label: string): string | null {
  const l = label.toLowerCase().replace(/\s+/g, " ");
  if (/\bx[ -]?int/.test(l)) return "x-intercept";
  if (/\by[ -]?int/.test(l)) return "y-intercept";
  if (/asymptote/.test(l)) return "asymptote";
  if (/\bmax/.test(l)) return "max";
  if (/\bmin(?!ute)/.test(l)) return "min";
  if (/vertex/.test(l)) return "vertex";
  if (/domain/.test(l)) return "domain";
  if (/range/.test(l)) return "range";
  if (/period/.test(l)) return "period";
  if (/amplitude/.test(l)) return "amplitude";
  if (/slope/.test(l)) return "slope";
  return null;
}

/** One part, reduced: its final value, the exact form it approximates (if
 * any), the labels that carry meaning, and -- for several solutions -- each
 * item reduced the same way. */
export type Part = {
  final: string;
  exact: string | null;
  /** The variable or name in front ("x", "y", "A"), for pairing list items. */
  name: string | null;
  phrase: string | null;
  args: string | null;
  list: Part[] | null;
};

/** Top-level items of "5 or -5", "2, 3", "x=2 and y=3": several solutions. A
 * "±" is two of them: "±3" is 3 and -3. */
function listItems(s: string): string[] | null {
  const items: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (depth === 0) {
      const rest = s.slice(i);
      const sep = c === "," ? 1 : (rest.match(/^\s+(or|and)\s+/i)?.[0].length ?? 0);
      if (sep) {
        items.push(s.slice(from, i));
        from = i + sep;
        i += sep - 1;
      }
    }
  }
  items.push(s.slice(from));
  const clean = items
    .map((x) => x.trim())
    .filter(Boolean)
    .flatMap((x) => {
      const at = x.indexOf("±");
      if (at < 0) return [x];
      const left = x.slice(0, at);
      const right = x.slice(at + 1);
      return [left + "+" + right, left + "-" + right];
    });
  return clean.length > 1 ? clean : null;
}

export function readPart(rawPart: string, inherited: string | null = null): Part {
  let s = tidy(rawPart).replace(/[.;,]\s*$/, "").trim();
  let phrase: string | null = null;
  let args: string | null = null;
  let name: string | null = null;
  let labelled = false;
  for (let i = 0; i < 3; i++) {
    const m = s.match(LABEL);
    if (!m) break;
    if (m[4]) phrase = meaningOf(m[4]) ?? phrase;
    else {
      phrase = meaningOf(m[1]) ?? phrase;
      name = m[1].toLowerCase();
    }
    if (m[2]) args = m[2].replace(/\s+/g, "");
    s = s.slice(m[0].length).trim();
    labelled = true;
  }
  name = name ?? inherited;
  // Several solutions: each item keeps its own label and exact form, and
  // inherits the one in front ("x=5 or -5": both are x).
  const items = listItems(s);
  if (items) return { final: s, exact: null, name, phrase, args, list: items.map((x) => readPart(x, name)) };
  // "a ≈ b": b is the value given, a the exact form it approximates.
  let exact: string | null = null;
  if (s.includes("≈")) {
    const sides = s.split("≈").map((x) => x.trim());
    s = sides.pop()!;
    exact = sides.pop() ?? null;
    if (exact?.includes("=")) exact = exact.split("=").pop()!.trim();
  }
  // "A(8) = 1200(1.02)^8 = 1405.99": after a label, a chain of "=" is one
  // quantity worked out, and its last side is the answer. Without a label it
  // is an equation ("2x+3y=6") and stays whole.
  if (labelled && s.includes("=")) {
    const last = s.split("=").pop()!.trim();
    if (last) s = last;
  }
  return { final: s, exact, name, phrase, args, list: null };
}

/** The final value of a part (for tests and the page). */
export const partFinal = (rawPart: string) => readPart(rawPart).final;

/** The parts of an answer, split on ";" or a new line. */
export function partsOf(raw: string): string[] {
  return tidy(raw)
    .split(/;|\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** A trailing unit word taken off: "911.06 birds" -> "911.06". Not a
 * maths word ("3 sqrt" stays as it is). */
const withoutUnit = (s: string) =>
  s.replace(/(\d|\))\s*([a-zA-Z]{2,})\.?$/, (all, end: string, w: string) => (MATH_WORDS.has(w.toLowerCase()) ? all : end)).trim();
const flat = (s: string) => s.replace(/\s+/g, "").toLowerCase();

/** Two values, compared by value with the grading code. Prose is not. */
function valueSame(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (flat(a) === flat(b)) return true;
  // compareAnswers cuts text at "is"/"for"/"because": "the function is
  // increasing" and "... decreasing" would be judged by their first words.
  // Anything with a real word in it is equal only when it reads the same.
  if (hasWords(a) || hasWords(b)) return false;
  const ua = withoutUnit(a);
  const ub = withoutUnit(b);
  return compareAnswers(ua, ub) === "same" || sameReading(ua, ub);
}

/** Two plain decimals that agree to the precision of the shorter one:
 * "0.973" and "0.97". Only used where the exact forms already agree. */
function roundsAlike(a: string, b: string): boolean {
  const ua = withoutUnit(a);
  const ub = withoutUnit(b);
  const ma = ua.match(/^-?\d+(?:\.(\d+))?$/);
  const mb = ub.match(/^-?\d+(?:\.(\d+))?$/);
  if (!ma || !mb) return false;
  const d = Math.min(ma[1]?.length ?? 0, mb[1]?.length ?? 0);
  return Number(ua).toFixed(d) === Number(ub).toFixed(d);
}

function partsEqual(pa: Part, pb: Part): boolean {
  // Labels that carry meaning, when both sides have one.
  if (pa.phrase && pb.phrase && pa.phrase !== pb.phrase) return false;
  if (pa.args && pb.args && pa.args !== pb.args && !valueSame(pa.args.slice(1, -1), pb.args.slice(1, -1))) return false;
  if (pa.list || pb.list) {
    const la = pa.list ?? [pa];
    const lb = pb.list ?? [pb];
    if (la.length !== lb.length) return false;
    // Items that name different variables ("x=2, y=3") pair by name: a system
    // with its values swapped is wrong. Items of one variable ("x=5 or x=-5")
    // may come in any order.
    const names = new Set([...la, ...lb].map((x) => x.name ?? ""));
    const used = new Set<number>();
    return la.every((x) => {
      const j = lb.findIndex(
        (y, k) => !used.has(k) && (names.size <= 1 || x.name === y.name) && partsEqual({ ...x, list: null }, { ...y, list: null }),
      );
      if (j < 0) return false;
      used.add(j);
      return true;
    });
  }
  if (pa.exact && pb.exact) {
    // Both give an exact form: it must agree ("22/7 ≈ 3.14" is not "π ≈ 3.14"),
    // and the approximations must agree to the shorter one's precision.
    return valueSame(pa.exact, pb.exact) && (valueSame(pa.final, pb.final) || roundsAlike(pa.final, pb.final));
  }
  // One side gives "exact ≈ approx", the other one value: it may be either.
  if (pa.exact) return valueSame(pa.final, pb.final) || valueSame(pa.exact, pb.final);
  if (pb.exact) return valueSame(pa.final, pb.final) || valueSame(pa.final, pb.exact);
  return valueSame(pa.final, pb.final);
}

const partSame = (a: string, b: string) => partsEqual(readPart(a), readPart(b));

/** Expected parts, matched in order by some of the read's parts. Returns the
 * indexes of the read parts used, or null. */
function inOrder(needles: string[], hay: string[]): number[] | null {
  const used: number[] = [];
  let at = 0;
  for (const n of needles) {
    while (at < hay.length && !partSame(hay[at], n)) at++;
    if (at === hay.length) return null;
    used.push(at++);
  }
  return used;
}

/** A part that is only a value -- digits and operators, or a label and one:
 * "-5", "x=5", "(2,3)". An extra one of these in a read is a contradiction,
 * not a description. */
const bareValue = (p: string) => /^[-+*/^().,\d\s∞π√]+$/.test(readPart(p).final);

/**
 * Judges a read (or a read key answer) against the expected one. `got` and
 * `want` are final answers or whole answers; both are split into parts.
 */
export function judgeAnswer(got: string, want: string): ReadVerdict {
  const g = partsOf(got);
  const w = partsOf(want);
  if (!g.length || !w.length) return !g.length && !w.length ? "same" : "different";
  let verdict: ReadVerdict = "different";
  if (g.length === w.length) {
    if (g.every((p, i) => partSame(p, w[i]))) verdict = "same";
  } else if (g.length > w.length) {
    // The full description against the teacher's short final answer: every
    // expected part is there in order, the last read part is the last
    // expected one, and what is extra is description, not another value.
    // Matched from the end, where a final answer sits: "2log_2(10) hours;
    // t≈6.64 hours" against "2log_2(10) hours ≈ 6.64 hours" is the second part.
    const back = inOrder([...w].reverse(), [...g].reverse());
    const used = back?.map((i) => g.length - 1 - i);
    if (used && used.includes(g.length - 1) && g.every((p, i) => used.includes(i) || !bareValue(p))) verdict = "same";
  } else if (inOrder(g, w)) {
    // Fewer parts, each matching an expected part: faithful, incomplete.
    verdict = "parts_missing";
  }
  if (verdict !== "different") {
    const ug = unitsIn(got);
    const uw = unitsIn(want);
    if (ug.size && uw.size && [...ug].sort().join() !== [...uw].sort().join()) return "different";
    return verdict;
  }
  // Words a person must read ("all reals" for "(-∞,∞)", a description in other
  // words) -- unless the numbers in them already disagree.
  // Labels do not count as words here: "max=5" against "min=5" is wrong, not
  // a question for a person.
  const text = (raw: string) => partsOf(raw).map((p) => readPart(p).final).join("; ");
  if ((hasWords(text(got)) || hasWords(text(want))) && numbersIn(got) === numbersIn(want)) return "needs_human_check";
  return "different";
}
