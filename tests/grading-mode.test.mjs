// The grading mode itself (docs/design/grading-modes-and-dok-grid.md, G1).
// A test is graded as a Percentage (today; what no mode means) or
// Standards-Based (0–4). Decided: chosen at setup and switchable any time; a
// new test starts in the mode the teacher used last; switching changes no
// stored grade. Saving the mode is proven by the persistence guard and the
// round-trip invariant (migration 20261020120000) and, on the database, by
// supabase/checks/grading-mode-round-trip.sql. Made-up data only (rule R8).
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
const { gradingModeOf, GRADING_MODES } = bundle("lib/grading-mode.ts");


test("two modes; no mode is Percentage", () => {
  assert.deepEqual(GRADING_MODES.map((m) => m.mode), ["percentage", "sbg"]);
  assert.equal(gradingModeOf({}), "percentage");
  assert.equal(gradingModeOf({ gradingMode: "sbg" }), "sbg");
  assert.equal(gradingModeOf({ gradingMode: "abc" }), "percentage");
});

// Ricky, 27 Oct 2026: the class has the mode now, and a new test takes it --
// the "last mode used" default and the choice at setup are gone. See
// tests/class-grading-mode.test.mjs.
test("setup offers no choice: a new test takes its class's mode", () => {
  const src = readFileSync("components/teacher-scan.tsx", "utf8");
  assert.match(src, /const gradingMode: GradingMode = editing \? gradingModeOf\(editing\) : classGradingMode\(w, classroom\);/);
  assert.doesNotMatch(src, /lastGradingMode/, "no 'last mode used' is read or written");
  assert.match(src, /gradingMode === "sbg" \? \{ gradingMode: "sbg" as const \} : \{\}/);
});

test("the save schema keeps the teacher's last mode", () => {
  const src = readFileSync("app/api/workspace/route.ts", "utf8");
  assert.match(src, /lastGradingMode: z\.enum\(\["percentage", "sbg"\]\)\.optional\(\)/);
});
