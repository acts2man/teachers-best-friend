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
  assert.match(ui, /printHtml\(\(practiceOnly \? "Practice · " : ""\) \+ s\.title, mathTextToHtml\(material\)\);/);
  assert.match(ui, /printHtml\(\s*s\.title \+ " · Exit ticket",\s*mathTextToHtml\(/);
  // On screen it is built as elements, never as an HTML string.
  const comp = readFileSync("components/math-text.tsx", "utf8");
  assert.doesNotMatch(comp, /dangerouslySetInnerHTML/);
  // No math library was added.
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  for (const lib of ["katex", "temml", "mathjax", "mathjax-full", "better-react-mathjax"])
    assert.ok(!(lib in { ...pkg.dependencies, ...pkg.devDependencies }), lib);
});
