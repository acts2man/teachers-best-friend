/**
 * Comparing two written math answers the way a careful teacher would: the
 * same value written differently is the same answer, and anything that might
 * not be is reported as not the same.
 *
 * Used where the app checks its own work -- comparing the answer key it worked
 * out against a second, independent solve -- never to give a student credit.
 * Student answers are judged by the grading model's verdict and the teacher.
 *
 * The rule that matters most: a sign is never ignored. "2x/(x²+4)" and
 * "2x/(x²−4)" are different, "4" and "−4" are different. Every path through
 * here either evaluates both expressions numerically (so a sign changes the
 * value) or compares the text with the sign still in it.
 */

export type Verdict = "same" | "different";

/**
 * LaTeX the model may use for a read answer, rewritten as plain math.
 *
 * Without this a read like "\\frac{2x}{x^2+4}" could not be evaluated, so the
 * check that a "match" really equals the key (provablyDifferent) had nothing to
 * compare and let the model's word stand: a sign flip written that way would
 * be marked correct. No saved read has come back as LaTeX so far (0 of 841 on
 * 12 Oct 2026); this closes the gap before one does. Innermost fractions first,
 * so nested ones unwind.
 */
function fromLatex(raw: string): string {
  if (!raw.includes("\\")) return raw;
  // A command ends where its letters end: "x\\le2" is "x <= 2". (A word
  // boundary missed that, because a digit is a word character.)
  const cmd = (names: string) => new RegExp("\\\\(?:" + names + ")(?![a-zA-Z])", "g");
  let s = raw.replace(cmd("left|right"), "");
  // Operators first, so "\\cdot2\\frac{1}{2}" and "\\cdot 2\\frac{1}{2}" read the same.
  s = s.replace(cmd("cdot|times"), "*").replace(cmd("div"), "/");
  // A mixed number, "2\\frac{1}{2}" or "12\\frac{1}{2}", is the whole part
  // PLUS the fraction -- not times it, and the whole part is every digit (it
  // used to take only the last one, reading 12 1/2 as 2.5). Not after a
  // letter, digit, "." or "^", where the number is part of something else.
  s = s.replace(/(^|[^\w.^}])(\d+)\s*\\[dt]?frac\s*\{(\d+)\}\s*\{(\d+)\}/g, "$1($2+$3/$4)");
  for (let i = 0; i < 6; i++)
    s = s
      .replace(/\^\{([^{}]*)\}/g, "^($1)")
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, "sqrt($1)")
      .replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "(($1)/($2))");
  s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, "sqrt($1)");
  s = s.replace(cmd("pi"), "pi");
  s = s
    .replace(cmd("leqslant|leq|le"), "<=")
    .replace(cmd("geqslant|geq|ge"), ">=")
    .replace(cmd("lt"), "<")
    .replace(cmd("gt"), ">")
    .replace(cmd("neq|ne"), "!=")
    .replace(cmd("infty"), "∞");
  return s.replace(/\\[,;:! ]/g, "");
}

/** Characters people and models use that mean the same thing. */
function canonical(raw: string): string {
  return (
    fromLatex(raw)
      // Superscripts first: NFKC below would turn x² into "x2".
      .replace(/\u00B2/g, "^2")
      .replace(/\u00B3/g, "^3")
      .replace(/\u00B9/g, "^1")
      .replace(/\u2070/g, "^0")
      .replace(/[\u2074-\u2079]/g, (d) => "^" + (d.charCodeAt(0) - 0x2070))
      .replace(/\u207B/g, "^-")
      .normalize("NFKC")
      .replace(/[\u2212\u2012\u2013\u2014\u2010\uFE63\uFF0D]/g, "-") // minus signs and dashes
      .replace(/[\u00D7\u22C5\u00B7]/g, "*") // times signs and dots
      .replace(/\u00F7/g, "/")
      .replace(/\u2044/g, "/") // fraction slash
      .replace(/\u221A/g, "sqrt")
      .replace(/\u03C0/g, "pi")
      .replace(/[\u201C\u201D\u2018\u2019"']/g, "")
      .replace(/[[{]/g, "(")
      .replace(/[\]}]/g, ")")
      .toLowerCase()
      .trim()
  );
}

/**
 * The final answer alone, without the commentary a key tends to carry:
 * "x = 15/2; x=5 is excluded", "5/(x+2), with x ≠ 0, −2", "x = −4, no
 * extraneous solution". Domain restrictions and notes are dropped; the
 * answer itself, sign included, is kept.
 */
export function finalAnswer(raw: string): string {
  let s = canonical(raw);
  // Notes after a separator: "; x=5 is excluded", ", with x ≠ 0", "(x ≠ 2)".
  s = s.split(/;|\bwith\b|\bwhere\b|\bfor\b|\bno extraneous\b|\bexcluded\b|\bextraneous\b|\bis\b|\bbecause\b|\bequivalently\b|,\s*or\b|\brestrictions?\b/)[0];
  // A second clause naming another value: "x = 2, x = 0 is extraneous".
  s = s.replace(/,\s*[a-z]\s*=.*$/, "");
  s = s.replace(/,?\s*\(?\s*[a-z]\s*(≠|!=|<>)[^)]*\)?\s*$/g, "");
  s = s.replace(/,?\s*[a-z]\s*(≠|!=)\s*[-\d.,\s/a-z]*$/g, "");
  // "x = 15/2 = 7.5" -> the last side; "x = -4" -> "-4". Only for a single
  // variable on the left, so an equation answer ("y = 2x + 1") keeps its rhs.
  // "x = -4" -> "-4": a single variable on the left is the answer's label.
  // Longer chains are left to collapseChain, which checks they agree.
  const sides = s.split("=").map((p) => p.trim()).filter(Boolean);
  if (sides.length > 1 && /^[a-z]$/.test(sides[0])) s = sides.slice(1).join("=");
  return s.replace(/[.,]\s*$/, "").replace(/\s+/g, "").trim();
}

// ---- A tiny, safe arithmetic evaluator (no eval) ---------------------------

type Tok = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

function tokenize(s: string): Tok[] | null {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const v = Number(s.slice(i, j));
      if (!Number.isFinite(v)) return null;
      out.push({ t: "num", v });
      i = j;
      continue;
    }
    if (/[a-z]/.test(c)) {
      let j = i;
      while (j < s.length && /[a-z]/.test(s[j])) j++;
      const word = s.slice(i, j);
      // Known words stay whole; anything else is a run of single variables
      // ("xy" is x*y), as a student writes it.
      if (word === "sqrt" || word === "pi") out.push({ t: "id", v: word });
      else for (const ch of word) out.push({ t: "id", v: ch });
      i = j;
      continue;
    }
    if ("+-*/^()".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
      continue;
    }
    return null;
  }
  // Implied multiplication: 2x, 3(x+1), (x+1)(x-1), x(x+2).
  const withMul: Tok[] = [];
  for (const tok of out) {
    const prev = withMul[withMul.length - 1];
    const prevEnds =
      prev && (prev.t === "num" || (prev.t === "id" && prev.v !== "sqrt") || (prev.t === "op" && prev.v === ")"));
    const startsValue = tok.t === "num" || tok.t === "id" || (tok.t === "op" && tok.v === "(");
    // "&" is multiplication written without a sign. It binds tighter than an
    // explicit * or /, the way answer keys and graphing calculators read it:
    // "3x/2(x-3)" is 3x over 2(x-3), "1/2x" is 1 over 2x.
    if (prevEnds && startsValue) withMul.push({ t: "op", v: "&" });
    withMul.push(tok);
  }
  return withMul;
}

/** Evaluates at given variable values; NaN when it cannot. */
function evaluate(tokens: Tok[], vars: Record<string, number>): number {
  let i = 0;
  const peek = () => tokens[i];
  const take = () => tokens[i++];
  function primary(): number {
    const tok = take();
    if (!tok) return NaN;
    if (tok.t === "num") return tok.v;
    if (tok.t === "id") {
      if (tok.v === "pi") return Math.PI;
      if (tok.v === "sqrt") return Math.sqrt(unary());
      return tok.v in vars ? vars[tok.v] : NaN;
    }
    if (tok.v === "(") {
      const v = sum();
      if (take()?.v !== ")") return NaN;
      return v;
    }
    return NaN;
  }
  function power(): number {
    const base = primary();
    if (peek()?.t === "op" && peek()!.v === "^") {
      take();
      return Math.pow(base, unary());
    }
    return base;
  }
  function unary(): number {
    if (peek()?.t === "op" && (peek()!.v === "-" || peek()!.v === "+")) {
      const sign = take()!.v === "-" ? -1 : 1;
      return sign * unary();
    }
    return power();
  }
  function implied(): number {
    let v = unary();
    while (peek()?.t === "op" && peek()!.v === "&") {
      take();
      v *= unary();
    }
    return v;
  }
  function product(): number {
    let v = implied();
    while (peek()?.t === "op" && (peek()!.v === "*" || peek()!.v === "/")) {
      const op = take()!.v;
      const r = implied();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }
  function sum(): number {
    let v = product();
    while (peek()?.t === "op" && (peek()!.v === "+" || peek()!.v === "-")) {
      const op = take()!.v;
      const r = product();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  const v = sum();
  return i === tokens.length ? v : NaN;
}

const SAMPLE_POINTS = [0.37, 1.91, -2.73, 3.3, -0.61, 5.17];

/**
 * Whether two answers are the same answer.
 *
 * Both are reduced to the final answer, then -- when both read as arithmetic
 * in the same variables -- evaluated at several points and compared. That is
 * what makes "15/2" and "7.5", or "2x/(x^2-4)" and "2x/((x-2)(x+2))", the same,
 * while "-4" and "4" (or a + where a − belongs) come out different. Anything
 * that does not read as arithmetic is compared as text, sign included. When in
 * doubt the answer is "different": a disagreement sends the question to the
 * teacher, and a teacher glancing at a question is cheap.
 */
/**
 * "(2x+4)/(x(x+1)) = 2(x+2)/(x(x+1))" or "15/2 = 7.5": the same answer shown
 * in two forms. Reduced to its last form, but only when every form really is
 * the same value -- an actual equation ("2x + 3y = 6") is left whole and
 * compared as written, so two different equations never collapse to "6".
 */
function collapseChain(s: string): string {
  if (!s.includes("=")) return s;
  const sides = s.split("=").filter(Boolean);
  if (sides.length < 2) return s;
  for (let i = 1; i < sides.length; i++)
    if (sameValue(sides[i - 1], sides[i]) !== true) return s;
  return sides[sides.length - 1];
}

/** true / false when both sides evaluate in the same variables; null when
 * they cannot be compared that way. */
function sameValue(fa: string, fb: string): boolean | null {
  const ta = tokenize(fa);
  const tb = tokenize(fb);
  if (!ta || !tb) return null;
  const names = (ts: Tok[]) =>
    [...new Set(ts.filter((t) => t.t === "id" && t.v !== "pi" && t.v !== "sqrt").map((t) => t.v))].sort();
  const va = names(ta);
  const vb = names(tb);
  if (va.join() !== vb.join()) return null;
  let compared = 0;
  for (const [k, x] of SAMPLE_POINTS.entries()) {
    const vars: Record<string, number> = {};
    va.forEach((n, j) => (vars[n] = x + j * 0.53 + k * 0.01));
    const ra = evaluate(ta, vars);
    const rb = evaluate(tb, vars);
    if (!Number.isFinite(ra) || !Number.isFinite(rb)) continue;
    compared++;
    const scale = Math.max(1, Math.abs(ra), Math.abs(rb));
    if (Math.abs(ra - rb) > 1e-9 * scale) return false;
  }
  return compared >= 2 ? true : null;
}

/** The "; "-separated parts of a multi-part answer, or null when either side
 * is a single answer or the two have different numbers of parts (then the
 * whole-answer comparison below decides, as before -- a key whose second part
 * is a note, "x = 15/2; x = 5 is excluded", stays a single answer). */
const splitParts = (s: string) => s.split(";").map((p) => p.trim()).filter(Boolean);
const multiPart = (s: string) => splitParts(s).length > 1;

function pairedParts(a: string, b: string): [string, string][] | null {
  const pa = splitParts(a);
  const pb = splitParts(b);
  if (pa.length < 2 || pa.length !== pb.length) return null;
  return pa.map((p, i) => [p, pb[i]]);
}

/**
 * The answer as written, LaTeX unpacked and signs normalised, but with its
 * brackets and inequality signs KEPT -- canonical() turns "[" into "(", which
 * is right for grouping and wrong for an interval, where "[2,5]" and "(2,5)"
 * are different answers.
 */
function bare(raw: string): string {
  return fromLatex(raw)
    .normalize("NFKC")
    .replace(/[\u2212\u2012\u2013\u2014\u2010\uFE63\uFF0D]/g, "-")
    .replace(/\u2264/g, "<=")
    .replace(/\u2265/g, ">=")
    .replace(/\binf(inity)?\b/gi, "∞")
    .replace(/\boo\b/gi, "∞")
    .replace(/\s+/g, "")
    .replace(/\+∞/g, "∞")
    .toLowerCase();
}

/** "(1/2, -3)", "[2,5)", "(-∞,2]": a pair, point or interval -- its brackets
 * and its top-level items. Null for anything else. LaTeX is unpacked first,
 * so "\\left(\\frac{1}{2}, -3\\right)" is a pair too (it used to be checked
 * before, and a sign flip inside one slipped through). */
function bracketed(raw: string): { open: string; close: string; items: string[] } | null {
  const s = bare(raw);
  if (s.length < 3 || !"([".includes(s[0]) || !")]".includes(s[s.length - 1])) return null;
  const items: string[] = [];
  let depth = 0;
  let from = 1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      // The opening bracket closes before the end: "(1)+(2)" is not a pair.
      if (depth === 0 && i !== s.length - 1) return null;
    } else if (c === "," && depth === 1) {
      items.push(s.slice(from, i));
      from = i + 1;
    }
  }
  items.push(s.slice(from, -1));
  return items.length >= 2 && items.every(Boolean) ? { open: s[0], close: s[s.length - 1], items } : null;
}

/** Both answers as pairs/intervals with the same number of items: whether
 * their brackets differ in a way that matters, and the items to compare. */
function pairedBrackets(a: string, b: string): { bracketsDiffer: boolean; items: [string, string][] } | null {
  const ba = bracketed(a);
  const bb = bracketed(b);
  if (!ba || !bb || ba.items.length !== bb.items.length) return null;
  // Only an interval's brackets carry meaning; "(1,3)" vs "(1,3)" as points
  // never differ by bracket. A square bracket on either side makes it one.
  const interval = /[[\]]/.test(ba.open + ba.close + bb.open + bb.close);
  return {
    bracketsDiffer: interval && (ba.open !== bb.open || ba.close !== bb.close),
    items: ba.items.map((x, i) => [x, bb.items[i]]),
  };
}

/** "x<=-2", "-2>=x" (flipped to the variable's side): a one-variable
 * inequality. Null for anything else, including an equation. */
function inequality(input: string): { v: string; op: string; rhs: string } | null {
  // "x > 2, x ≠ 5": the restriction is a note on the answer, not part of the
  // inequality -- it used to make the whole answer uncomparable.
  const raw = input.replace(/,\s*[a-z]\s*(≠|!=|\\neq?(?![a-z]))[^,]*$/i, "");
  const s = bare(raw);
  // One inequality only: "x < -2 or x > 3" (a union, in either order) is
  // left to the general comparison rather than read as its first clause.
  if (/\b(or|and)\b|,|∪|∩|(<|>).*(<|>)/.test(raw.toLowerCase()) || /(or|and)/.test(s)) return null;
  const flip: Record<string, string> = { "<": ">", ">": "<", "<=": ">=", ">=": "<=" };
  let m = s.match(/^([a-z])(<=|>=|<|>)(.+)$/);
  if (m) return { v: m[1], op: m[2], rhs: m[3] };
  m = s.match(/^(.+?)(<=|>=|<|>)([a-z])$/);
  if (m) return { v: m[3], op: flip[m[2]], rhs: m[1] };
  return null;
}

const infinite = (x: string) => x.includes("∞");

function itemSame(x: string, y: string): boolean {
  if (infinite(x) || infinite(y)) return bare(x) === bare(y);
  return compareSingle(x, y) === "same";
}

function itemProvablyDifferent(x: string, y: string): boolean {
  if (infinite(x) || infinite(y)) {
    const sign = (v: string) => (bare(v).startsWith("-") ? "-∞" : "∞");
    // ∞ against a number, or -∞ against ∞, differ; two spellings of the same
    // infinity ("+∞", "oo", "\\infty") do not.
    return infinite(x) !== infinite(y) || sign(x) !== sign(y);
  }
  return provablyDifferentSingle(x, y);
}

/**
 * Two reads of ONE answer that say the same thing: identical once spacing,
 * case and symbols are normalised, or both math that evaluates equal ("4" and
 * "4.0", "1/2" and "0.5"). No note-stripping -- unlike compareAnswers, which
 * cuts a key at "is"/"for" and would call "the slope is positive" and "the
 * slope is negative" the same (#125 review, round 4).
 */
export function sameReading(a: string, b: string): boolean {
  // Brackets kept: "(2,5)" and "[2,5]" are different readings.
  if (bare(a).replace(/["'“”‘’]/g, "") === bare(b).replace(/["'“”‘’]/g, "")) return true;
  // Evaluated only when both are plainly math: a digit or operator, and no
  // run of letters other than sqrt/pi -- otherwise "no" and "on" are the same
  // product of two variables.
  const mathy = (s: string) => /[\d+\-*/^]/.test(s) && !/[a-z]{2,}/i.test(s.replace(/sqrt|pi/gi, ""));
  if (!mathy(a) || !mathy(b)) return false;
  const fa = canonical(a).replace(/\s+/g, "");
  const fb = canonical(b).replace(/\s+/g, "");
  if (/[[\]{}]/.test(a + b)) return false;
  return fa === fb || sameValue(fa, fb) === true;
}

export function compareAnswers(a: string, b: string): Verdict {
  const parts = pairedParts(a, b);
  if (parts) return parts.every(([x, y]) => compareOne(x, y) === "same") ? "same" : "different";
  // Both multi-part, but a different number of parts: not the same answer.
  if (multiPart(a) && multiPart(b)) return "different";
  return compareOne(a, b);
}

function compareOne(a: string, b: string): Verdict {
  const br = pairedBrackets(a, b);
  if (br) return !br.bracketsDiffer && br.items.every(([x, y]) => itemSame(x, y)) ? "same" : "different";
  const ia = inequality(a);
  const ib = inequality(b);
  if (ia && ib) return ia.v === ib.v && ia.op === ib.op && itemSame(ia.rhs, ib.rhs) ? "same" : "different";
  return compareSingle(a, b);
}

function compareSingle(a: string, b: string): Verdict {
  const fa = collapseChain(finalAnswer(a));
  const fb = collapseChain(finalAnswer(b));
  if (!fa || !fb) return fa === fb ? "same" : "different";
  if (fa === fb) return "same";
  return sameValue(fa, fb) === true ? "same" : "different";
}

/**
 * True only when both answers evaluate as numbers or expressions and their
 * values PROVABLY differ (checked at several points). Used to catch a
 * grading model's "match" on an answer that is not the key's value -- a sign
 * off, 5 for 5/x -- without second-guessing answers that are words or choices,
 * where this returns false and the model's verdict stands.
 */
export function provablyDifferent(a: string, b: string): boolean {
  // Part by part when both are multi-part with the same count: a sign flip in
  // the second part ("y=4; (0,-10/3)" for "y=4; (0,10/3)") is a difference,
  // not hidden behind an equal first part.
  const parts = pairedParts(a, b);
  if (parts) return parts.some(([x, y]) => provablyDifferentOne(x, y));
  // Both multi-part with different counts: the parts they share are still
  // compared, so "x=2; y=-3; z=1; 4" against "x=2; y=3; z=1" is caught by its
  // sign even before the count sends it to the teacher.
  if (multiPart(a) && multiPart(b)) {
    const pa = splitParts(a);
    const pb = splitParts(b);
    return pa.slice(0, pb.length).some((x, i) => provablyDifferentOne(x, pb[i]));
  }
  return provablyDifferentOne(a, b);
}

function provablyDifferentOne(a: string, b: string): boolean {
  const br = pairedBrackets(a, b);
  if (br) return br.bracketsDiffer || br.items.some(([x, y]) => itemProvablyDifferent(x, y));
  const ia = inequality(a);
  const ib = inequality(b);
  // A different letter ("t >= 2" for "x >= 2") is not a provable difference
  // in value; the model's verdict and the teacher decide that one.
  if (ia && ib) return ia.v === ib.v && (ia.op !== ib.op || itemProvablyDifferent(ia.rhs, ib.rhs));
  return provablyDifferentSingle(a, b);
}

function provablyDifferentSingle(a: string, b: string): boolean {
  const fa = collapseChain(finalAnswer(a));
  const fb = collapseChain(finalAnswer(b));
  if (!fa || !fb || fa === fb) return false;
  return sameValue(fa, fb) === false;
}
