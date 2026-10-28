// Ricky, 20 Oct 2026: the grading mode is chosen only at the start of setting
// up a test. The test page shows which mode it uses but has no switch, and
// editing a test in setup shows its mode without letting it change. On a
// Standards-Based test every question is locked at 4 points: the points
// editor, the whole-test total and the Edit dialog's total are gone for it.
// 0–4 scoring itself is not in this change, so the "coming next" note stays.
// Made-up data only (rule R8).
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
const wf = bundle("lib/teacher-workflow.ts");
const { SBG_QUESTION_POINTS, gradingModeLabel } = bundle("lib/grading-mode.ts");

const q = (id, points) => ({ id, number: 1, standard: "S.1", dok: 1, verified: true, excluded: false, ...(points ? { points } : {}) });
const r = (questionId, match) => ({ id: "r-" + questionId, studentId: "s1", questionId, answer: "x", correct: match === 100, match, verified: true });
const base = {
  id: "a1", title: "Quiz", pointsPossible: 10,
  questions: [q("q1", 6), q("q2", 2), q("q3", 2)],
  responses: [r("q1", 0), r("q2", 100), r("q3", 100)],
};
const sbg = { ...base, gradingMode: "sbg" };

test("every question on a Standards-Based test is worth 4, whatever points it carried", () => {
  assert.equal(SBG_QUESTION_POINTS, 4);
  assert.deepEqual(sbg.questions.map((x) => wf.questionPoints(sbg, x)), [4, 4, 4]);
  assert.equal(wf.totalPoints(sbg), 12);
  // The stored points are left alone, just not read.
  assert.deepEqual(sbg.questions.map((x) => x.points), [6, 2, 2]);
  // A Percentage test is unchanged.
  assert.deepEqual(base.questions.map((x) => wf.questionPoints(base, x)), [6, 2, 2]);
  assert.equal(wf.totalPoints(base), 10);
});

test("a Standards-Based question's points cannot be changed", () => {
  assert.equal(wf.setQuestionPoints(sbg, "q1", 9), sbg, "returned untouched");
  assert.equal(wf.setQuestionPoints(base, "q1", 9).questions[0].points, 9, "a Percentage test still can");
});

test("its score weighs every question the same: 2 of 3 right is 67%, not the 40% the old points gave", () => {
  assert.equal(wf.studentReview(base, "s1").score, 40, "6-point question wrong: 4 of 10");
  assert.equal(wf.studentReview(sbg, "s1").score, 67, "each out of 4: 8 of 12");
  assert.equal(wf.studentReview(sbg, "s1").pointsPossible, 12);
});

test("the test page shows the mode but has no switch; points are locked for Standards-Based", () => {
  const src = readFileSync("components/teacher-assessments.tsx", "utf8");
  assert.doesNotMatch(src, /GradingModeChoice/, "no switch on the test page");
  assert.doesNotMatch(src, /switchGradingMode/);
  assert.match(src, /<strong className="grading-mode-shown">\{gradingModeLabel\(a\)\}<\/strong>/);
  assert.equal(gradingModeLabel({ gradingMode: "sbg" }), "Standards-Based (0–4)");
  assert.equal(gradingModeLabel({}), "Percentage");
  // 0–4 scoring shipped (26 Oct 2026): the "coming next" note is gone.
  assert.doesNotMatch(src, /coming next/);
  // Locked points: a read-only 4 instead of the editor, and no total to set.
  assert.match(src, /gradingModeOf\(a\) === "sbg" \? \(\s+\/\/ Locked at 4 on a Standards-Based test\.\s+<span className="locked-points"/);
  assert.match(src, /if \(gradingModeOf\(a\) === "sbg"\) \{\s+const renamed = editMeta\.title/);
  assert.match(src, /gradingModeOf\(a\) === "sbg" \? \(\s+<p className="field-help">\s+Standards-Based: every question is worth/);
});

// Since 27 Oct 2026 the class has the mode (tests/class-grading-mode.test.mjs):
// test setup shows it, and editing a test shows the test's own.
test("test setup never asks: a new test shows its class's mode, an edited one its own", () => {
  const src = readFileSync("components/teacher-scan.tsx", "utf8");
  assert.match(src, /\{editing \? gradingModeLabel\(editing\) : gradingModeName\(gradingMode\)\}/);
  assert.doesNotMatch(src, /<GradingModeChoice/);
  assert.match(src, /mode === "assignment" && gradingMode !== "sbg" && \(\s+<label className="block-label">\s+Points possible/, "no points total for a Standards-Based test");
});
