// A writing rubric score is already 1–4, so its level comes from the 0–4 cuts
// (Beginning < 1.95, Approaching 1.95–2.94, Proficient 2.95–3.44, Exceeding
// 3.45+), not from the score as a percentage -- 2 of 4 read as 50% was the
// lowest level. And the scale is named like the levels: 1 Beginning,
// 2 Approaching, 3 Proficient, 4 Exceeding (Ricky, 20 Oct 2026). Replaces
// #173. Made-up data only (rule R8).
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
const { masteryLevel4, rubricLevel, score4Shown } = bundle("lib/mastery-levels.ts");
const { writingClassAnalysis } = bundle("lib/teacher-class-analysis.ts");
const { defaultRubric } = bundle("lib/writing-rubrics.ts");

test("the 0–4 cuts, on the score rounded to one decimal", () => {
  const at = (x) => masteryLevel4(x).level;
  assert.equal(at(1.94), "Beginning");
  assert.equal(at(1.95), "Approaching", "1.95 shows 2.0");
  assert.equal(at(2.94), "Approaching");
  assert.equal(at(2.95), "Proficient");
  assert.equal(at(3.44), "Proficient");
  assert.equal(at(3.45), "Exceeding");
  assert.equal(score4Shown(1.95), 2);
});

test("each rubric score is its level's name: 1 Beginning, 2 Approaching, 3 Proficient, 4 Exceeding", () => {
  assert.deepEqual([0, 1, 2, 3, 4].map((n) => rubricLevel(n, 4).level), ["Beginning", "Beginning", "Approaching", "Proficient", "Exceeding"]);
  assert.equal(rubricLevel(3, 6).level, "Approaching", "a 6-point trait is put on 0–4: 3 of 6 is 2.0");
});

test("a score of 2 shows '2 Approaching' with an Approaching badge", () => {
  const level = rubricLevel(2, 4);
  assert.equal(`2 ${level.level}`, "2 Approaching");
  assert.equal(level.tone, "yellow", "the Approaching colour");
  const ui = readFileSync("components/teacher-assessments.tsx", "utf8");
  assert.match(ui, /<Pill tone=\{"level-" \+ rubricLevel\(response\.rubricScore, dimension\.max\)\.tone\}>\s+\{response\.rubricScore\} \{rubricLevel\(response\.rubricScore, dimension\.max\)\.level\}/);
  assert.match(ui, /dimension\.max === 4 && level > 0 && " " \+ rubricLevel\(level, 4\)\.level/, "the 4-point buttons are named");
});

test("the class summary reads a trait on the 0–4 cuts", () => {
  const students = ["a", "b", "c"].map((id) => ({ id, name: id, evidence: [] }));
  const r = (studentId, rubricScore) => ({ id: studentId, studentId, questionId: "t1", answer: "", correct: rubricScore === 4, match: rubricScore * 25, rubricScore, verified: true });
  const a = { id: "w", rubric: [{ id: "t1", name: "Evidence", max: 4, descriptor: "", standard: "" }], questions: [], responses: [r("a", 2), r("b", 2), r("c", 3)] };
  const [row] = writingClassAnalysis(a, students);
  assert.deepEqual(row.byLevel.Approaching.map((s) => s.id), ["a", "b"], "2 of 4 is Approaching (it was Beginning at 50%)");
  assert.deepEqual(row.byLevel.Proficient.map((s) => s.id), ["c"]);
  assert.equal(row.averageLabel, "2.3 / 4");
  assert.equal(row.level.level, "Approaching");
  const ui = readFileSync("components/teacher-assessments.tsx", "utf8");
  assert.match(ui, /<Pill tone=\{row\.level \? "level-" \+ row\.level\.tone : "neutral"\}>/);
  assert.match(ui, /<LevelStudents byLevel=\{row\.byLevel\} ranges=\{SCORE4_RANGES\}/, "0–4 ranges, not percentages");
});

test("the scale is named like the levels", () => {
  for (const row of defaultRubric("response", 4))
    assert.match(row.descriptor, /\(1 Beginning, 2 Approaching, 3 Proficient, 4 Exceeding\.\)/, row.name);
});
