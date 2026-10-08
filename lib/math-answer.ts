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

/** Characters people and models use that mean the same thing. */
function canonical(raw: string): string {
  return (
    raw
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

export function compareAnswers(a: string, b: string): Verdict {
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
  const fa = collapseChain(finalAnswer(a));
  const fb = collapseChain(finalAnswer(b));
  if (!fa || !fb || fa === fb) return false;
  return sameValue(fa, fb) === false;
}
