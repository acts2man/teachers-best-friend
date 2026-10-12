// PR 2, item 5: a handwritten sign flip marked correct.
//
// Reported (Ricky, "Rational Expressions", 7 Oct 2026, Q5): the student wrote
// 2x/(x^2-4), the read said +4, and it was marked correct. That scan's output was
// purged by the 48h window and the class was deleted on 12 Oct, so the case
// cannot be replayed. What can be shown:
//   - the guard that demotes a "match" whose read value differs from the key
//     shipped on 8 Oct, the day after; it sends the plain-notation flip to Unsure;
//   - it could NOT read a LaTeX-style answer, so a flip written that way kept the
//     model's "match". This closes that.
import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

function bundle(path) {
  const r = buildSync({ entryPoints: [path], bundle: true, platform: "node", format: "cjs", write: false });
  const m = { exports: {} };
  new Function("module", "exports", r.outputFiles[0].text)(m, m.exports);
  return m.exports;
}
const { provablyDifferent, compareAnswers } = bundle("lib/math-answer.ts");
const { normalizeRecognizedResponses } = bundle("lib/teacher-workflow.ts");

const assessment = (key) => ({ questions: [{ id: "q5", number: 5, answer: key, excluded: false }], responses: [] });
const grade = (key, read) =>
  normalizeRecognizedResponses(assessment(key), "s", [{ questionId: "q5", answer: read, verdict: "match", finalAnswer: read }])[0];

for (const key of ["2x/(x²−4)", "2x/(x^2-4)", "2x/((x+2)(x-2))"]) {
  for (const read of ["2x/(x²+4)", "2x / (x^2 + 4)", "\\frac{2x}{x^2+4}", "\\dfrac{2x}{x^{2}+4}", "\\frac{2x}{\\left(x^2+4\\right)}"]) {
    test(`a flipped sign read as ${read} against ${key} goes to Unsure, never correct`, () => {
      assert.equal(provablyDifferent(read, key), true);
      const r = grade(key, read);
      assert.equal(r.correct, false);
      assert.equal(r.confidence, 0, "Unsure: the teacher looks");
    });
  }
}

test("a LaTeX read that IS the key still matches", () => {
  for (const [read, key] of [
    ["\\frac{2x}{x^2-4}", "2x/(x^2-4)"],
    ["\\frac{1}{2}", "0.5"],
    ["\\sqrt{12}-1", "√12-1"],
    ["3 \\cdot 4", "12"],
    ["\\frac{\\frac{1}{2}}{2}", "1/4"],
  ]) {
    assert.equal(compareAnswers(read, key), "same", read + " = " + key);
    assert.equal(provablyDifferent(read, key), false);
  }
  const r = grade("2x/(x^2-4)", "\\frac{2x}{x^2-4}");
  assert.equal(r.correct, true);
});

test("words and choices are untouched: a backslash-free answer reads as before", () => {
  assert.equal(compareAnswers("B", "b"), "same");
  assert.equal(provablyDifferent("the main idea is friendship", "friendship"), false);
});
