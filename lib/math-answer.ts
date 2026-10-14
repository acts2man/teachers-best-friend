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
      // Scientific notation: "3.2x10^5" and "3.2e5" are numbers, not a
      // variable x or e (G14 review).
      // Only as the whole answer. ("3.2e5" is tried both ways by readings():
      // in an exponential answer "2e+1" is 2e + 1.)
      .replace(/^([+-]?[\d.]+)\s*[x*]\s*10\s*\^/, "$1*10^")
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
  // "x is 5" names the answer the way "x = 5" does; without this the note
  // split below cut it at "is", and "x is 5" and "x is 6" were both "x" (G14).
  // Only when math follows: "A is correct" stays words (#152 review).
  s = s.replace(/^([a-z])\s+(is|equals)\s+(?=[-+.(\d√]|sqrt|pi)/, "$1 = ");
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
  // A thousands comma ("9,487") is part of the number: without this the
  // evaluator could not read it, and "9,587" for "9,487" stood (G14). Only a
  // comma followed by exactly three digits; "24, 20, 16" keeps its commas.
  s = s.replace(/(\d),(?=\d{3}(?!\d))/g, "$1");
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

/** Plainly math: a digit, and no run of letters other than sqrt/pi -- so
 * "5 apples" or "no solution" is never evaluated as a product of variables. */
const plainMath = (s: string) => /\d/.test(s) && !/[a-z]{2,}/.test(s.replace(/sqrt|pi/g, ""));

/** A key note ("is extraneous", "x = 5 is excluded"): such text is never a
 * list of answers. */
const NOTE = /\b(is|are|extraneous|excluded|rejected|because|for|where|with|when|restrictions?|not|no)\b/;

/** The answer with a thousands comma read as part of the number ("1,200"),
 * and an explicit "+/-" (or a leading "+-") read as ±. "4 + -2i" is not ±. */
function listText(raw: string): string {
  return canonical(raw)
    .replace(/\+\s*\/\s*-/g, "±")
    .replace(/(^|=)\s*\+-/g, "$1±")
    .replace(/(\d),(?=\d{3}(?!\d))/g, "$1")
    .trim();
}

/** Split at top-level commas, "or" and "and" -- never inside brackets, so
 * "(1, 2), (3, 4)" is two points, not four fragments. */
function topSplit(s: string, words = true): string[] {
  let depth = 0;
  let marked = "";
  for (const c of s) {
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    marked += c === "," && depth === 0 ? "\u0000" : c;
  }
  return marked.split(words ? /\u0000|\bor\b|\band\b/ : /\u0000|\band\b/).map((p) => p.trim());
}

/**
 * "x = 3, x = -3", "-3 or 3", "x = ±3", "(2 ± √5)/3": an answer that is a LIST
 * of values of ONE unknown, as its values (± written out as both). Null for a
 * single value, for anything with a note, for a pair or interval ("(1, -3)"),
 * which bracketed() reads instead, and for a system ("x = 3, y = 4"), which
 * system() reads -- its values are not interchangeable. A thousands comma
 * ("1,200") or a decimal comma ("3,5") is not a list.
 */
function solutionList(raw: string): string[] | null {
  if (bracketed(raw)) return null;
  const s = listText(raw);
  if (NOTE.test(s) || /[<>≤≥≠!;]/.test(s) || /^[+-]?\d+,\d{1,2}$/.test(s)) return null;
  const label = (p: string) => p.match(/^([a-z])\s*=/)?.[1];
  const value = (p: string) => p.replace(/^[a-z]\s*=\s*/, "").replace(/\s+/g, "");
  if (s.includes("±")) {
    // One ±, anywhere -- inside brackets too: "(2 ± √5)/3" is (2+√5)/3 and
    // (2-√5)/3, so the sign itself is replaced rather than the text split.
    const body = value(s);
    if (/,|\bor\b|\band\b|=/.test(body) || body.split("±").length !== 2) return null;
    return [body.replace("±", "+"), body.replace("±", "-")];
  }
  const raw2 = topSplit(s);
  if (new Set(raw2.map(label).filter(Boolean)).size > 1) return null;
  const parts = raw2.map(value);
  if (parts.length < 2 || parts.some((p) => !p || p.includes("=") || !plainMath(p))) return null;
  return parts;
}

/** "x = 3, y = 4", "y = 4 and x = 3": a system's values by unknown, in the
 * unknowns' order. Null unless every part is "<letter> = <value>" with a
 * different letter. */
function system(raw: string): string[] | null {
  if (bracketed(raw)) return null;
  const s = listText(raw);
  if (NOTE.test(s) || /[<>≤≥≠!;±]/.test(s)) return null;
  const parts = topSplit(s, false).map((p) => p.match(/^([a-z])\s*=\s*(.+)$/));
  if (parts.length < 2 || parts.some((m) => !m || !plainMath(m[2]) || m[2].includes("="))) return null;
  const vars = parts.map((m) => m![1]);
  if (new Set(vars).size !== vars.length) return null;
  return parts
    .map((m) => [m![1], m![2].replace(/\s+/g, "")] as const)
    .sort((x, y) => x[0].localeCompare(y[0]))
    .map(([v, x]) => v + "=" + x);
}

/** The values of a list, a pair or a system, or null for a single answer. */
function itemsOf(raw: string): string[] | null {
  const sys = system(raw);
  return solutionList(raw) ?? bracketed(raw)?.items ?? (sys ? sys.map((p) => p.slice(2)) : null);
}

/** Two lists of values are the same answer: the same values, in any order. */
function sameList(la: string[], lb: string[]) {
  if (la.length !== lb.length) return false;
  const left = [...lb];
  return la.every((x) => {
    const i = left.findIndex((y) => compareSingle(x, y) === "same");
    return i >= 0 && left.splice(i, 1).length === 1;
  });
}

/**
 * "12 cm³", "-50%", "$4.50", "-$4.50", "90°", "3.5 m/s", "30.14 years": a
 * signed number and the one-word unit written with it. Null for anything else (a plain number included:
 * the evaluator handles those). Read off finalAnswer(), so spaces are gone.
 */
function quantity(f: string): { value: number; unit: string } | null {
  let s = f;
  let unit = "";
  const money = s.match(/^([+-]?)([$€£])/);
  if (money) {
    s = money[1] + s.slice(money[0].length);
    unit = money[2];
  }
  const m = s.match(/^([+-]?)(\d+(?:\.\d+)?|\.\d+)(?:\/(\d+(?:\.\d+)?))?(.*)$/);
  if (!m) return null;
  const rest = m[4];
  if (unit ? rest : !/^(%|°[cf]?|[a-z]{1,12}(\^[23])?(\/[a-z]{1,3}(\^[23])?)?)$/.test(rest)) return null;
  if (!unit && !rest) return null;
  const value = (m[1] === "-" ? -1 : 1) * Number(m[2]) / (m[3] ? Number(m[3]) : 1);
  return Number.isFinite(value) ? { value, unit: unit || rest } : null;
}

/** true / false when two numbers-with-units provably differ or not; null when
 * that cannot be told this way. Same unit: by value. One side without its
 * unit: only an exact sign flip is provable ("-12" for "12 cm" -- "120" for
 * "12 cm" may be a different unit). Different units: never (120 mm is 12 cm). */
function quantitiesDiffer(fa: string, fb: string): boolean | null {
  const qa = quantity(fa);
  const qb = quantity(fb);
  const plain = (f: string) => (/^[+-]?(\d+(?:\.\d+)?|\.\d+)(\/\d+)?$/.test(f) ? Number(eval0(f)) : null);
  const close = (x: number, y: number) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
  if (qa && qb) return qa.unit === qb.unit ? !close(qa.value, qb.value) : null;
  const q = qa || qb;
  const n = qa ? plain(fb) : qb ? plain(fa) : null;
  if (!q || n === null || !Number.isFinite(n)) return null;
  // Decided here either way: falling through would read the unit's letters as
  // variables, and "12" would "differ" from "12 m" (#152 review).
  return q.value !== 0 && close(q.value, -n);
}

/** A plain number or fraction ("-3", "15/2") as a number. */
function eval0(f: string): number {
  const t = tokenize(f);
  return t ? evaluate(t, {}) : NaN;
}

/** Whether an expression takes more than one value as its variables change
 * ("5/x" does; "x/x" and "5" do not). */
function varies(f: string): boolean {
  const t = tokenize(f);
  if (!t) return false;
  const names = [...new Set(t.filter((x) => x.t === "id" && x.v !== "pi" && x.v !== "sqrt").map((x) => x.v))];
  if (!names.length) return false;
  const seen: number[] = [];
  for (const [k, x] of SAMPLE_POINTS.entries()) {
    const vars: Record<string, number> = {};
    names.forEach((n, j) => (vars[n] = x + j * 0.53 + k * 0.01));
    const v = evaluate(t, vars);
    if (Number.isFinite(v)) seen.push(v);
  }
  return seen.some((v) => Math.abs(v - seen[0]) > 1e-9 * Math.max(1, Math.abs(v), Math.abs(seen[0])));
}

/** "120,150,180" is a number or a list of three numbers, and "3.2e5" is
 * 320000 or 3.2·e·5; both readings are tried, and the guard fires only when
 * the answers differ under every one (G14 review). */
function readings(s: string): string[] {
  if (/^\s*[+-]?\d{1,3}(,\d{3})+\s*$/.test(s)) return [s, s.replace(/,/g, ", ")];
  const sci = s.trim().match(/^([+-]?\d*\.?\d+)e([+-]?\d+)$/i);
  if (sci) return [s, `${sci[1]}*10^(${sci[2]})`];
  return [s];
}

export function compareAnswers(a: string, b: string): Verdict {
  return readings(a).some((x) => readings(b).some((y) => compareRead(x, y) === "same")) ? "same" : "different";
}

function compareRead(a: string, b: string): Verdict {
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
  // A system is the same answer only with the same value for each unknown.
  const sa = system(a);
  const sb = system(b);
  if (sa && sb) return sa.length === sb.length && sa.every((x, i) => x[0] === sb[i][0] && compareSingle(x.slice(2), sb[i].slice(2)) === "same") ? "same" : "different";
  // A list of values ("x = 3, x = -3", "±3") is the same answer only as the
  // same list; it used to be cut to its first value (G14).
  const la = solutionList(a);
  const lb = solutionList(b);
  if (la || lb) return la && lb && sameList(la, lb) ? "same" : "different";
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
  return readings(a).every((x) => readings(b).every((y) => provablyDifferentRead(x, y)));
}

function provablyDifferentRead(a: string, b: string): boolean {
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
  // Only one side has parts: "2; -3" against "2" is an answer with a value
  // the other does not have (G14). A key's NOTE after ";" ("x = 15/2; x = 5
  // is excluded") is words, not a value, and stays a single answer.
  if (multiPart(a) !== multiPart(b)) {
    const [many, one] = multiPart(a) ? [splitParts(a), b] : [splitParts(b), a];
    // The parts may be the other side's list written with ";": "x = 2; x = -2"
    // for "±2", "4; 5" for "4, 5", "x = 2; y = 3" for "(2, 3)". Compared as
    // lists (in any order) when both read as the same number of values.
    // By unknown when both name them ("x = 4; y = 3" for "x = 3, y = 4" is
    // caught, #155 review round 2); in any order only when both are one
    // unknown's roots; otherwise by position, as an ordered pair is.
    const joined = many.join(", ");
    if (system(joined) && system(one)) return provablyDifferentOne(joined, one);
    const ml = solutionList(joined);
    const ol = solutionList(one);
    if (ml && ol) return provablyDifferentOne(joined, one);
    const mi = itemsOf(joined);
    const oi = itemsOf(one);
    if (mi && oi && mi.length === oi.length) return mi.some((x, i) => provablyDifferentOne(x, oi[i]));
    if (provablyDifferentOne(many[0], one)) return true;
    // A value, "-3" or "y = -3" -- not a restriction ("x ≠ 0") or a relation.
    const value = (p: string) => {
      const c = canonical(p).replace(/^[a-z]\s*=\s*/, "");
      return plainMath(c) && !NOTE.test(c) && !/[=<>≠!≤≥]/.test(c);
    };
    if (value(one) && many.slice(1).every(value)) return true;
    return false;
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
  // "3" for "±3", or "x = 3, x = 5" for "x = ±3": a value missing or a value
  // that is not in the key's list (G14). A list against a single value is
  // only provable when the single side is plainly a value.
  // A system: the same unknowns with a value that differs ("x=4, y=3" for
  // "x=3, y=4"). Different unknowns are not provable.
  const sa = system(a);
  const sb = system(b);
  if (sa && sb)
    return sa.length === sb.length && sa.every((x, i) => x[0] === sb[i][0]) && sa.some((x, i) => provablyDifferentSingle(x.slice(2), sb[i].slice(2)));
  const la = solutionList(a);
  const lb = solutionList(b);
  if (la && lb) {
    if (la.length !== lb.length) return true;
    // An item may itself be a point: "(1, -2), (3, 4)". A point can only
    // match a point, so a number never stands in for one.
    const point = (x: string) => !!bracketed(x);
    return la.some((x) => lb.every((y) => point(x) !== point(y) || provablyDifferentOne(x, y)));
  }
  if (la || lb) {
    const list = (la ?? lb)!;
    const single = la ? b : a;
    // A pair written with brackets ("(3, 4)" for "3, 4"): compared item by item.
    const pair = bracketed(single);
    if (pair) return pair.items.length !== list.length || list.some((x, i) => provablyDifferentSingle(x, pair.items[i]));
    if (system(single)) return false;
    return plainMath(canonical(single)) && !NOTE.test(canonical(single)) && finalAnswer(single) !== "";
  }
  return provablyDifferentSingle(a, b);
}

function provablyDifferentSingle(a: string, b: string): boolean {
  const fa = collapseChain(finalAnswer(a));
  const fb = collapseChain(finalAnswer(b));
  if (!fa || !fb || fa === fb) return false;
  // A multiple-choice answer ("D", "D. 8,662", "b)") is a choice, not
  // arithmetic: "d.8662" would otherwise read as d times 0.8662.
  // Only against a number or another choice: "-a" for "a" is still a sign.
  const choice = (f: string) => /^[a-e]$|^[a-z][.)]/.test(f);
  const number = (f: string) => /^[+-]?[\d.]+$/.test(f);
  if ((choice(fa) && (choice(fb) || number(fb))) || (choice(fb) && number(fa))) return false;
  // Units, %, °, $: "-12" for "12 cm³" (G14). The evaluator reads "cm" as
  // two variables and gave up.
  const units = quantitiesDiffer(fa, fb);
  if (units !== null) return units;
  const same = sameValue(fa, fb);
  if (same !== null) return same === false;
  // A variable on one side only: "5" for "5/x" (G14). A constant never equals
  // an expression that changes with its variable; one that cancels ("x/x")
  // is a constant and is left alone, and so is anything with words.
  if (plainMath(fa) && plainMath(fb)) {
    const ta = tokenize(fa);
    const tb = tokenize(fb);
    const constant = (f: string) => !!tokenize(f) && Number.isFinite(eval0(f));
    if (ta && tb && ((constant(fa) && varies(fb)) || (constant(fb) && varies(fa)))) return true;
  }
  return false;
}
