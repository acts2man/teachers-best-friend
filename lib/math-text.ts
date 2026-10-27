/**
 * Math in lesson text, typeset (Ricky, 25 Oct 2026): practice tasks and exit
 * tickets showed "(x-2)^2" and "2/(x-4)" as typed. This finds exactly those
 * two things in plain text -- a power (base^exponent) and a fraction
 * (numerator/denominator) -- and turns each into MathML, which every current
 * browser draws itself (true superscripts, stacked fractions) on screen and
 * in print / Save as PDF. No library: MathML Core is built in (Chrome 109+,
 * Safari, Firefox).
 *
 * Deliberately narrow, because the text is written by the AI and edited by the
 * teacher and is mostly words:
 *   - an operand is a number, a lone letter (x, not "and"), or a bracket group
 *     holding only numbers, lone letters and operators;
 *   - a fraction needs no spaces around "/" and is never part of a chain
 *     (10/27/2026 stays a date) or a web address;
 *   - anything else -- "and/or", "km/h", "(see above)" -- is left as typed.
 * Everything that is not one of those pieces stays plain text.
 *
 * Review of #186 (27 Oct): a bracket right after a letter is a function call
 * (f(x), P(A), sin(x)), one operand, never a fraction's start; and short slash
 * words are never stacked (notAFraction). Browsers that cannot lay out MathML
 * get the text exactly as typed (lib/mathml-support.ts).
 */

export type MathNode =
  | { t: "mi" | "mn" | "mo"; v: string }
  | { t: "mrow"; c: MathNode[] }
  | { t: "msup"; base: MathNode; exp: MathNode }
  | { t: "mfrac"; num: MathNode; den: MathNode };

export type MathSegment = { kind: "text"; text: string } | { kind: "math"; node: MathNode; source: string };

const isLetter = (c: string | undefined) => !!c && /[A-Za-z]/.test(c);
const isDigit = (c: string | undefined) => !!c && /[0-9]/.test(c);
/** What a bracket group may hold: numbers, letters (checked as lone below),
 * operators, spaces and nested brackets. */
const GROUP_CHARS = /^[0-9A-Za-z+\-−–*×÷·=.,^/ ()]*$/;

type Atom = { node: MathNode; inner: MathNode | null; end: number };

/** A bracket group from `i` (at "("), or null. `node` keeps the brackets;
 * `inner` is the content alone, for a fraction or an exponent, which show
 * the grouping by their shape instead. */
function group(s: string, i: number): Atom | null {
  if (s[i] !== "(") return null;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === "(") depth++;
    else if (s[j] === ")" && --depth === 0) {
      const content = s.slice(i + 1, j);
      if (!content.trim() || !GROUP_CHARS.test(content)) return null;
      // Only lone letters: "(see above)" is words, not math.
      if (/[A-Za-z]{2,}/.test(content)) return null;
      const inner: MathNode = { t: "mrow", c: rowOf(content) };
      return {
        node: { t: "mrow", c: [{ t: "mo", v: "(" }, inner, { t: "mo", v: ")" }] },
        inner,
        end: j + 1,
      };
    }
  }
  return null;
}

/** Function names a call may have beyond one letter. */
const FUNCTIONS = new Set(["sin", "cos", "tan", "log", "ln", "exp"]);

/** A function call at `i`: a lone letter (f, g, P) or a known function name,
 * then a bracket group -- f(x), P(A), sin(x). One operand, brackets kept. */
function call(s: string, i: number): Atom | null {
  if (!isLetter(s[i]) || isLetter(s[i - 1])) return null;
  let k = i;
  while (isLetter(s[k])) k++;
  const name = s.slice(i, k);
  if (s[k] !== "(" || (name.length > 1 && !FUNCTIONS.has(name))) return null;
  const args = group(s, k);
  if (!args) return null;
  return { node: { t: "mrow", c: [{ t: "mi", v: name }, args.node] }, inner: null, end: args.end };
}

/** A number, a lone letter, a function call or a bracket group at `i`. */
function atom(s: string, i: number): Atom | null {
  if (s[i] === "(") return group(s, i);
  const fn = call(s, i);
  if (fn) return fn;
  if (isDigit(s[i])) {
    if (isLetter(s[i - 1])) return null;
    const m = /^[0-9]+(?:\.[0-9]+)?/.exec(s.slice(i))!;
    return { node: { t: "mn", v: m[0] }, inner: null, end: i + m[0].length };
  }
  if (isLetter(s[i]) && !isLetter(s[i - 1]) && !isLetter(s[i + 1]))
    return { node: { t: "mi", v: s[i] }, inner: null, end: i + 1 };
  return null;
}

/** An exponent: an atom, or a negative number or letter. */
function exponent(s: string, i: number): Atom | null {
  if ((s[i] === "-" || s[i] === "−") && (isDigit(s[i + 1]) || isLetter(s[i + 1]))) {
    const a = atom(s, i + 1);
    return a && { node: { t: "mrow", c: [{ t: "mo", v: "−" }, a.node] }, inner: null, end: a.end };
  }
  return atom(s, i);
}

/** An atom with an optional exponent. */
function power(s: string, i: number): (Atom & { raised: boolean }) | null {
  const base = atom(s, i);
  if (!base) return null;
  if (s[base.end] === "^") {
    const exp = exponent(s, base.end + 1);
    if (exp) return { node: { t: "msup", base: base.node, exp: exp.inner ?? exp.node }, inner: null, end: exp.end, raised: true };
  }
  return { ...base, raised: false };
}

/** Slash words that are not fractions, as written (case ignored). */
const SLASH_WORDS = new Set(["n/a", "w/o", "y/n", "i/o", "a/b", "c/o", "b/w", "24/7", "9/11"]);
/** Words that make the number pair after them a date ("due 3/4"). */
const DATE_CUE = /(?:^|[\s(])(?:on|by|due|until|till|from|before|after|since|through|thru|date|dated|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?),?\s+$/i;

/**
 * Whether the slash at [from, to) is a word or a date, not a fraction:
 * n/a, w/o, y/n, I/O, A/B, 24/7, 9/11; a grade range ("Grades 6/7"); or a
 * month/day date -- said with a date word before it ("due 3/4", "on Friday
 * 10/27") or written with a leading zero ("03/04"). A plain "3/4 cup" stays
 * a fraction: without one of those clues it reads as one.
 */
function notAFraction(s: string, from: number, to: number): boolean {
  const typed = s.slice(from, to);
  if (SLASH_WORDS.has(typed.toLowerCase())) return true;
  const date = /^(\d{1,2})\/(\d{1,2})$/.exec(typed);
  if (!date) return false;
  const before = s.slice(0, from);
  if (/\bgrades?\s+$/i.test(before)) return true;
  const [m, d] = [Number(date[1]), Number(date[2])];
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  return /^0\d/.test(date[1]) || /^0\d/.test(date[2]) || DATE_CUE.test(before);
}

/** The whitespace-delimited word around [from, to). */
function wordAround(s: string, from: number, to: number) {
  let a = from;
  let b = to;
  while (a > 0 && !/\s/.test(s[a - 1])) a--;
  while (b < s.length && !/\s/.test(s[b])) b++;
  return s.slice(a, b);
}

/** A power or a fraction starting at `i`, or null. */
function piece(s: string, i: number): { node: MathNode; end: number } | null {
  // Not in the middle of a word or a number ("km/h", "2026/27").
  // ("3x^2" is 3 then x squared: a letter may follow a digit.)
  // A bracket right after a letter is that letter's function call -- f(x) --
  // read from the letter, never a fraction starting at the bracket.
  if (isLetter(s[i - 1])) return null;
  if (isDigit(s[i]) && (isDigit(s[i - 1]) || s[i - 1] === ".")) return null;
  if (s[i - 1] === "/" || s[i - 1] === "^") return null;
  const first = power(s, i);
  if (!first) return null;
  if (s[first.end] === "/") {
    const second = power(s, first.end + 1);
    // A chain ("10/27/2026") or a web address is not a fraction.
    if (
      second &&
      s[second.end] !== "/" &&
      !isLetter(s[second.end]) &&
      !/:\/\/|www\./i.test(wordAround(s, i, second.end)) &&
      !notAFraction(s, i, second.end)
    )
      return {
        node: {
          t: "mfrac",
          num: first.raised ? first.node : (first.inner ?? first.node),
          den: second.raised ? second.node : (second.inner ?? second.node),
        },
        end: second.end,
      };
  }
  if (first.raised && !isLetter(s[first.end])) return { node: first.node, end: first.end };
  return null;
}

/** Plain math text (inside a bracket group) as MathML tokens, with any power
 * or fraction in it typeset too. */
function rowOf(text: string): MathNode[] {
  const out: MathNode[] = [];
  for (const seg of mathSegments(text)) {
    if (seg.kind === "math") {
      out.push(seg.node);
      continue;
    }
    for (const m of seg.text.matchAll(/[0-9]+(?:\.[0-9]+)?|[A-Za-z]|\S/g)) {
      const v = m[0];
      if (isDigit(v[0])) out.push({ t: "mn", v });
      else if (isLetter(v)) out.push({ t: "mi", v });
      else out.push({ t: "mo", v: v === "-" || v === "–" ? "−" : v === "*" ? "×" : v });
    }
  }
  return out;
}

/** The text split into plain runs and typeset pieces, in order. */
export function mathSegments(text: string): MathSegment[] {
  const out: MathSegment[] = [];
  let plain = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const found = c === "(" || isDigit(c) || isLetter(c) ? piece(text, i) : null;
    if (found) {
      if (plain) out.push({ kind: "text", text: plain });
      plain = "";
      out.push({ kind: "math", node: found.node, source: text.slice(i, found.end) });
      i = found.end;
    } else {
      plain += c;
      i++;
    }
  }
  if (plain) out.push({ kind: "text", text: plain });
  return out;
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** One node as MathML markup (escaped). */
export function nodeToMathML(n: MathNode): string {
  switch (n.t) {
    case "mi":
    case "mn":
    case "mo":
      return `<${n.t}>${escape(n.v)}</${n.t}>`;
    case "mrow":
      return `<mrow>${n.c.map(nodeToMathML).join("")}</mrow>`;
    case "msup":
      return `<msup>${nodeToMathML(n.base)}${nodeToMathML(n.exp)}</msup>`;
    case "mfrac":
      return `<mfrac>${nodeToMathML(n.num)}${nodeToMathML(n.den)}</mfrac>`;
  }
}

/** Text as HTML for printing: plain text escaped, each piece as an inline
 * <math> element that keeps the typed form as its text alternative. With
 * `mathml: false` (a browser that cannot lay MathML out), the text exactly as
 * typed, escaped. */
export function mathTextToHtml(text: string, { mathml = true }: { mathml?: boolean } = {}): string {
  if (!mathml) return escape(text);
  return mathSegments(text)
    .map((seg) =>
      seg.kind === "text"
        ? escape(seg.text)
        : `<math alttext="${escape(seg.source)}">${nodeToMathML(seg.node)}</math>`,
    )
    .join("");
}
