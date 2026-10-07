// The partial-credit scale a teacher grades with, and proof the new values
// flow through to scores and to PR #69's points totals.
//
// Ricky asked to replace Full / Half / None with No credit (0), 25, Half (50),
// 75, 90, Full (100). The 90 is for a small slip (e.g. a sign error) that
// shouldn't cost half the marks. Credit is stored as a plain percentage in
// response.match, so this is a UI/scale change, not a data-shape change:
// existing work graded none/half/full is already 0/50/100 and is untouched.
import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import path from "node:path";

const ROOT = process.cwd();
function bundle(entry) {
  const r = buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    absWorkingDir: ROOT,
    alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
  });
  const m = { exports: {} };
  new Function("module", "exports", r.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { CREDIT_LEVELS, applyGroupScore, pointsForScore, scoreLabel } =
  bundle("lib/teacher-workflow.ts");

test("the presets are the three clean ones; any other value comes from Percent", () => {
  assert.deepEqual(
    CREDIT_LEVELS.map((l) => l.value),
    [0, 50, 100],
  );
  assert.deepEqual(
    CREDIT_LEVELS.map((l) => l.label),
    ["No credit", "Half", "Full"],
  );
});

test("an arbitrary typed percent is stored, clamped, and only 100 is correct", () => {
  for (const value of [25, 75, 90]) {
    const a = applyGroupScore({ ...base, responses: [response("r", 0, false)] }, ["r"], value);
    assert.equal(a.responses[0].match, value);
    assert.equal(a.responses[0].correct, false, `${value} is partial`);
    assert.equal(a.responses[0].verified, true);
  }
  // Out of range is clamped by applyGroupScore.
  assert.equal(applyGroupScore({ ...base, responses: [response("r", 0, false)] }, ["r"], 150).responses[0].match, 100);
  assert.equal(applyGroupScore({ ...base, responses: [response("r", 0, false)] }, ["r"], -20).responses[0].match, 0);
});

function response(id, match, correct) {
  return { id, studentId: "s", questionId: "q", answer: "x", match, correct,
    misconception: "", confidence: 100, verified: false };
}
const base = { id: "a", classId: "c", title: "t", subject: "Math", grade: 4,
  framework: "California", createdAt: "", status: "Ready", source: "manual",
  targetStandards: [], questions: [], uploadIds: [] };

test("only 100 is marked correct; 90 and below are partial", () => {
  for (const level of CREDIT_LEVELS) {
    const a = applyGroupScore({ ...base, responses: [response("r", 0, false)] }, ["r"], level.value);
    const r = a.responses[0];
    assert.equal(r.match, level.value, `match for ${level.value}`);
    assert.equal(r.verified, true);
    assert.equal(r.correct, level.value === 100, `correct for ${level.value}`);
  }
});

test("the new values are preserved through PR #69's points totals", () => {
  // 90% of a 20-point test is 18 points, shown alongside the percentage.
  assert.equal(pointsForScore(90, 20), 18);
  assert.equal(pointsForScore(25, 20), 5);
  assert.equal(pointsForScore(75, 20), 15);
  assert.equal(scoreLabel(90, 20), "90% · 18/20");
  // Without a point total, the percentage still shows.
  assert.equal(scoreLabel(90, undefined), "90%");
});

test("work already graded at 25/75/90 keeps its score (no migration)", () => {
  // The 25/75/90 from the earlier six-button scale are just stored percentages;
  // they survive untouched and read back exactly.
  const { responseMatch } = bundle("lib/teacher-metrics.ts");
  for (const value of [0, 25, 50, 75, 90, 100]) {
    assert.equal(responseMatch(response("r", value, value === 100)), value);
  }
});

test("grade by question gives credit in points, with No credit and Full shortcuts (Ricky)", () => {
  const { readFileSync } = require("node:fs");
  const ui = readFileSync("components/teacher-review.tsx", "utf8");
  // "3 of 4": a number box out of what the question is worth.
  assert.match(ui, /of \{pointsText\(worth\)\} point/, "credit is entered as points of the question");
  assert.match(ui, /type="number"/, "the entry is a number box (numeric keyboard)");
  assert.match(ui, /onGrade\(0, errorType\)/, "No credit shortcut");
  assert.match(ui, /onGrade\(worth, ""\)/, "Full credit shortcut");
  // Stored as a share of the question, so 3 of 4 is 75% and a later change to
  // what the question is worth keeps the same share.
  assert.match(ui, /creditForPoints\(a, q, points\)/);
});
