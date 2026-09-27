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

test("the scale is exactly the six levels Ricky asked for, in order", () => {
  assert.deepEqual(
    CREDIT_LEVELS.map((l) => l.value),
    [0, 25, 50, 75, 90, 100],
  );
  assert.equal(CREDIT_LEVELS[0].label, "No credit");
  assert.equal(CREDIT_LEVELS[2].label, "Half");
  assert.equal(CREDIT_LEVELS.at(-1).label, "Full");
  // The 90 exists specifically for a small slip.
  assert.ok(CREDIT_LEVELS.some((l) => l.value === 90));
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

test("existing none/half/full work keeps its scores (no migration)", () => {
  // These are the literal stored values; re-applying them is a no-op on match.
  for (const [value, correct] of [[0, false], [50, false], [100, true]]) {
    const a = applyGroupScore({ ...base, responses: [response("r", value, correct)] }, ["r"], value);
    assert.equal(a.responses[0].match, value);
    assert.equal(a.responses[0].correct, value === 100);
  }
});

test("the grade-by-question UI renders the shared scale, not hard-coded buttons", () => {
  const { readFileSync } = require("node:fs");
  const ui = readFileSync("components/teacher-review.tsx", "utf8");
  assert.match(ui, /CREDIT_LEVELS\.map/, "buttons come from the shared constant");
  assert.ok(!/>\s*Full credit\s*</.test(ui), "the old Full credit button is gone");
});
