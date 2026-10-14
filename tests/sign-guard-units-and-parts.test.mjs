// Gap G14 (docs/system-map.md, rule R4 "never correct when wrong"): the check
// that takes a grading model's "match" away when the answer provably differs
// from the key (provablyDifferent, lib/math-answer.ts) was OFF for keys with
// units, %, °, $, ±, a second part, or a variable on one side only -- it could
// not evaluate them, so the model's word stood. A sign-flipped "-12" against
// "12 cm³" was marked correct.
//
// When the guard fires, the answer goes to the teacher as Unsure (not wrong).
// So a false alarm costs a glance -- but it must still be rare, so the second
// half of this file pins what must NOT fire.
//
// The answer-key check (compareAnswers) had two of the same holes: "x is 5"
// and "x is 6" were "the same", and so were "x = 3, x = -3" and "x = 3".
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

// [student's final answer, key]
const CAUGHT = [
  ["-12", "12 cm³"],
  ["-12 cm³", "12 cm³"],
  ["-12 cm^3", "12 cm³"],
  ["-50%", "50%"],
  ["-$4.50", "$4.50"],
  ["$-4.50", "$4.50"],
  ["-90°", "90°"],
  ["-3.5 m/s", "3.5 m/s"],
  ["3", "±3"],
  ["-3", "x = ±3"],
  ["x = 3", "x = +/- 3"],
  ["x = 3, x = 5", "x = ±3"],
  ["2; -3", "2"],
  ["x = 2; y = -3", "x = 2"],
  ["5", "5/x"],
  ["5/x", "5"],
  ["-30.14", "30.14 years"],
  ["9,587", "9,487"], // a thousands comma: the evaluator could not read it
  ["1,450", "550"],
];

const LEFT_ALONE = [
  ["12", "12 cm³"], // the unit left off, same value: the model and teacher decide
  ["12 cm³", "12 cm³"],
  ["12cm^3", "12 cm³"],
  ["120 mm", "12 cm"], // different units can be the same length
  ["0.5", "50%"],
  ["50 %", "50%"],
  ["$4.50", "4.50"],
  ["90 degrees", "90°"],
  ["x = 3, x = -3", "±3"],
  ["-3, 3", "x = ±3"],
  ["3 or -3", "±3"],
  ["x = -3 or x = 3", "x = ±3"],
  ["+/-3", "±3"],
  ["±3", "±3"],
  ["1,200", "1200"], // a thousands comma is not a second answer
  ["8,092", "8,092"],
  ["30.14", "30.14 years"],
  ["315 more miles", "315 miles"],
  ["24, 20, 16", "24, 20, 16"],
  ["D", "D. 8,662"], // a multiple-choice letter, not arithmetic
  ["D, 8,662", "D. 8,662"],
  ["B", "8,662"],
  ["5 apples", "5"], // words: the model's verdict stands
  ["15/2", "x = 15/2; x = 5 is excluded"], // a key's note is not a second part
  ["x = 2", "x = 2; x ≠ 0"], // nor is a restriction
  ["x = 2", "x = 2; x > 0"],
  ["1", "x/x"], // a variable that cancels is still a constant
  ["t >= 2", "x >= 2"],
  ["2; 3", "2; 3"],
  ["(1, -3)", "(1, -3)"],
];

test("G14: a sign flip or a wrong value is caught in units, %, °, $, ± and extra parts", () => {
  for (const [student, key] of CAUGHT) assert.equal(provablyDifferent(student, key), true, `${student} against the key ${key}`);
});

test("G14: the guard does not fire on answers that are, or may be, the key", () => {
  for (const [student, key] of LEFT_ALONE) assert.equal(provablyDifferent(student, key), false, `${student} against the key ${key}`);
});

test("G14: the answer-key check no longer calls different answers the same", () => {
  assert.equal(compareAnswers("x is 5", "x is 6"), "different");
  assert.equal(compareAnswers("x = 3, x = -3", "x = 3"), "different");
  assert.equal(compareAnswers("±3", "3"), "different");
});

test("the answer-key check still calls the same answer the same", () => {
  assert.equal(compareAnswers("x is 5", "x = 5"), "same");
  assert.equal(compareAnswers("x = 3, x = -3", "x = ±3"), "same");
  assert.equal(compareAnswers("x = -3 or x = 3", "x = 3, x = -3"), "same");
  assert.equal(compareAnswers("x = 2, x = 0 is extraneous", "x = 2"), "same");
  assert.equal(compareAnswers("x = 15/2; x = 5 is excluded", "15/2"), "same");
});

test("a sign flip is caught at any size, with any unit the guard reads", () => {
  for (const unit of ["cm", "cm³", "m²", "%", "°", "km/h", "ft"])
    for (const n of [1, 2.5, 12, 0.75, 1000]) {
      assert.equal(provablyDifferent(`-${n} ${unit}`, `${n} ${unit}`), true, `-${n} ${unit}`);
      assert.equal(provablyDifferent(`${n} ${unit}`, `${n} ${unit}`), false, `${n} ${unit}`);
    }
});
