// A 2.5-point test through the Edit dialog and the setup screen (#170 follow-up).
// Both rounded the total to a whole number: the Edit dialog opened at "2.5",
// saved 3, and -- 3 not being what the test was worth -- treated it as a new
// total and wiped every question's own points. Its input (step 1) also would
// not let a teacher submit 2.5 at all. Now the total keeps its decimals and an
// unchanged total never touches the questions. Made-up data only (rule R8).
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
const { parsePointsTotal, editAssessmentMeta, setQuestionPoints, totalPoints } = bundle("lib/teacher-workflow.ts");

const q = (id) => ({ id, number: 1, standard: "S.1", dok: 1, verified: true, excluded: false });
// 1 + 1 + 0.5: a question worth half a point.
const test25 = setQuestionPoints({ id: "a1", title: "Quiz", questions: [q("q1"), q("q2"), q("q3")], responses: [] }, "q3", 0.5);

test("open and save a 2.5-point test: the total and every question's points are unchanged", () => {
  assert.equal(test25.pointsPossible, 2.5);
  const shown = String(totalPoints(test25)); // what the Edit dialog opens with
  assert.equal(shown, "2.5");
  const saved = editAssessmentMeta(test25, "Quiz (renamed)", parsePointsTotal(shown));
  assert.equal(saved.title, "Quiz (renamed)");
  assert.equal(saved.pointsPossible, 2.5);
  assert.deepEqual(saved.questions.map((x) => x.points), [1, 1, 0.5], "the questions' own points survive a rename");
});

test("a changed total is still split evenly, replacing the questions' own points", () => {
  const saved = editAssessmentMeta(test25, "Quiz", parsePointsTotal("6"));
  assert.equal(saved.pointsPossible, 6);
  assert.deepEqual(saved.questions.map((x) => x.points), [undefined, undefined, undefined]);
  assert.equal(totalPoints(saved), 6);
});

test("totals keep their decimals; blank is no total; nonsense is refused", () => {
  assert.equal(parsePointsTotal("2.5"), 2.5);
  assert.equal(parsePointsTotal(" 18.75 "), 18.75);
  assert.equal(parsePointsTotal("2.555"), 2.56, "kept to 0.01, like every points value");
  assert.equal(parsePointsTotal("20"), 20);
  assert.equal(parsePointsTotal(""), undefined);
  for (const bad of ["0", "-3", "abc", "NaN", "Infinity", "1000001", "0.001"])
    assert.equal(parsePointsTotal(bad), null, bad);
  // Blank keeps whatever total the test had; it never clears the questions.
  const kept = editAssessmentMeta(test25, "Quiz", parsePointsTotal(""));
  assert.equal(kept.pointsPossible, 2.5);
  assert.deepEqual(kept.questions.map((x) => x.points), [1, 1, 0.5]);
});

test("both screens use it, and neither input rounds or refuses a decimal", () => {
  const edit = readFileSync("components/teacher-assessments.tsx", "utf8");
  const setup = readFileSync("components/teacher-scan.tsx", "utf8");
  assert.match(edit, /const next = editAssessmentMeta\(a, title, points\);/);
  assert.match(edit, /const points = parsePointsTotal\(editMeta\.points\);/);
  assert.match(setup, /pointsPossible: parsePointsTotal\(points\) \?\? undefined,/);
  for (const [name, src] of [["Edit dialog", edit], ["setup", setup]]) {
    assert.doesNotMatch(src, /Math\.round\(Number\((raw|points)\)\)/, name + ": the total is not rounded");
    assert.doesNotMatch(src, /min="1"\s+step="1"\s+inputMode="numeric"/, name + ": no whole-number-only input");
    assert.match(src, /min="0\.01"\s+step="0\.01"\s+inputMode="decimal"/, name + ": the input takes 2.5");
  }
});
