// Lesson math typeset (Ricky, 25 Oct 2026): practice tasks and exit tickets
// show "(x-2)^2" with a true exponent and "2/(x-4)" as a stacked fraction, on
// screen and in print / Save as PDF -- as MathML the browser draws itself, no
// library. scripts/browser-check/lesson-math.mjs measures the result.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";

function bundle(path) {
  const r = buildSync({ entryPoints: [path], bundle: true, platform: "node", format: "cjs", write: false });
  const m = { exports: {} };
  new Function("module", "exports", r.outputFiles[0].text)(m, m.exports);
  return m.exports;
}
const M = bundle("lib/math-text.ts");
const marked = (t) => M.mathSegments(t).map((s) => (s.kind === "math" ? "[" + s.source + "]" : s.text)).join("");

test("powers and fractions are found; the rest of the sentence stays as typed", () => {
  assert.equal(marked("Solve (x-2)^2 = 9."), "Solve [(x-2)^2] = 9.");
  assert.equal(marked("Simplify 2/(x-4) + 3."), "Simplify [2/(x-4)] + 3.");
  assert.equal(marked("Find 3x^2 + 2x - 1."), "Find 3[x^2] + 2x - 1.");
  assert.equal(marked("Evaluate 2^10 and e^(x+1)."), "Evaluate [2^10] and [e^(x+1)].");
  assert.equal(marked("x^-2 and (x+1)/(x-1)"), "[x^-2] and [(x+1)/(x-1)]");
  assert.equal(marked("x^2/4"), "[x^2/4]");
  assert.equal(marked("Use 1/2 cup."), "Use [1/2] cup.");
});

test("words, units, dates and web addresses are left alone", () => {
  for (const t of ["and/or", "Speed in km/h", "on 10/27/2026", "See https://a.org/x/y now", "Compute (144 − 36) ÷ 6", "(see above)", "a ratio 3:4"])
    assert.equal(marked(t), t, t);
});

test("MathML: a raised exponent and a stacked fraction, brackets kept on a base and dropped where the shape groups", () => {
  assert.equal(
    M.mathTextToHtml("(x-2)^2"),
    '<math alttext="(x-2)^2"><msup><mrow><mo>(</mo><mrow><mi>x</mi><mo>−</mo><mn>2</mn></mrow><mo>)</mo></mrow><mn>2</mn></msup></math>',
  );
  assert.equal(
    M.mathTextToHtml("2/(x-4)"),
    '<math alttext="2/(x-4)"><mfrac><mn>2</mn><mrow><mi>x</mi><mo>−</mo><mn>4</mn></mrow></mfrac></math>',
  );
});

test("printing escapes everything the AI or the teacher wrote", () => {
  const html = M.mathTextToHtml('<img src=x onerror="alert(1)"> & 1/2');
  assert.ok(!html.includes("<img"));
  assert.match(html, /^&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; <math/);
});

test("practice, exit tickets and their prints use it", () => {
  const ui = readFileSync("components/teacher-planning.tsx", "utf8");
  assert.match(ui, /<MathText text=\{content\.practice\[0\]\.q\} \/>/);
  assert.equal((ui.match(/<p><MathText text=\{p\.q\} \/><\/p>/g) || []).length, 2, "practice and exit tasks");
  assert.match(ui, /<MathText text=\{p\.a\} \/>/);
  assert.match(ui, /printHtml\(\(practiceOnly \? "Practice · " : ""\) \+ s\.title, mathTextToHtml\(material, \{ mathml: supportsMathML\(\) \}\)\);/);
  assert.match(ui, /printHtml\(\s*s\.title \+ " · Exit ticket",\s*mathTextToHtml\(/);
  // On screen it is built as elements, never as an HTML string.
  const comp = readFileSync("components/math-text.tsx", "utf8");
  assert.doesNotMatch(comp, /dangerouslySetInnerHTML/);
  // No math library was added.
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  for (const lib of ["katex", "temml", "mathjax", "mathjax-full", "better-react-mathjax"])
    assert.ok(!(lib in { ...pkg.dependencies, ...pkg.devDependencies }), lib);
});

// ---- review of #186 (27 Oct) ----

test("a bracket right after a letter is a function call: the whole call is the operand", () => {
  assert.equal(marked("f(x)/2"), "[f(x)/2]");
  assert.equal(marked("P(A)/P(B)"), "[P(A)/P(B)]");
  assert.equal(marked("g(2)/4"), "[g(2)/4]");
  assert.equal(marked("sin(x)^2"), "[sin(x)^2]");
  // f stays with its brackets, over 2 -- never "f" then (x) over 2.
  assert.equal(
    M.mathTextToHtml("f(x)/2"),
    '<math alttext="f(x)/2"><mfrac><mrow><mi>f</mi><mrow><mo>(</mo><mrow><mi>x</mi></mrow><mo>)</mo></mrow></mrow><mn>2</mn></mfrac></math>',
  );
  // A word before a bracket is neither a call nor a fraction start.
  assert.equal(marked("area(x)/2"), "area(x)/2");
});

test("short slash words, grade ranges and month/day dates are never stacked", () => {
  for (const t of ["n/a", "w/o help", "y/n", "I/O", "A/B test", "open 24/7", "9/11", "Grades 6/7", "Grade 6/7", "due 3/4", "on Friday 10/27", "03/04"])
    assert.equal(marked(t), t, t);
  // Real fractions still are.
  assert.equal(marked("Use 3/4 cup"), "Use [3/4] cup");
  assert.equal(marked("x/y"), "[x/y]");
});

test("a browser that cannot lay out MathML gets the text exactly as typed, on screen and in print", () => {
  assert.equal(M.mathTextToHtml("Solve (x-2)^2 = 9 & 2/(x-4)", { mathml: false }), "Solve (x-2)^2 = 9 &amp; 2/(x-4)");
  const comp = readFileSync("components/math-text.tsx", "utf8");
  assert.match(comp, /const mathml = useSyncExternalStore\(noChange, supportsMathML, \(\) => false\);\s*if \(!mathml\) return <>\{text\}<\/>;/);
  const ui = readFileSync("components/teacher-planning.tsx", "utf8");
  assert.equal((ui.match(/\{ mathml: supportsMathML\(\) \}/g) || []).length, 2, "both prints");
  const probe = readFileSync("lib/mathml-support.ts", "utf8");
  assert.match(probe, /<math><mspace height="23px" width="77px"><\/mspace><\/math>/);
  assert.match(probe, /Math\.abs\(box\.width - 77\) <= 1 && Math\.abs\(box\.height - 23\) <= 1/);
});
