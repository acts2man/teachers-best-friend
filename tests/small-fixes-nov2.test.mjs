// Small fixes from review (2 Nov 2026). Proven when:
//   (a) re-grading an answer with no tag picked ("") keeps its stored tag
//       (review of #195), as undefined always did;
//   (b) changing the Focus skill on a pre-teach lesson drops the pre-teach
//       focus -- extra codes, error counts, banner (review of #197);
//   (c) the share notes say what to do: upload it again as a new test
//       (review of #196);
//   (d) a lesson plan saves with no student or group selected (Ricky).
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);
function bundle(entry) {
  const r = buildSync({
    entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, absWorkingDir: ROOT,
    alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}
const { applyGroupScore } = bundle("lib/teacher-workflow.ts");
const planning = readFileSync("components/teacher-planning.tsx", "utf8");

const test1 = (errorType) => ({
  id: "a", classId: "c", title: "T", subject: "Math", grade: 4, framework: "California", createdAt: "", status: "Ready", source: "manual",
  targetStandards: [], uploadIds: [], questions: [],
  responses: [{ id: "r1", studentId: "s1", questionId: "q1", answer: "7", correct: false, match: 50, confidence: 90, verified: true, errorType }],
});

test("(a) re-grading with no tag picked keeps the stored tag; a new tag replaces it; full credit clears it", () => {
  assert.equal(applyGroupScore(test1("Sign Error"), ["r1"], 25, "").responses[0].errorType, "Sign Error", '"" is no choice');
  assert.equal(applyGroupScore(test1("Sign Error"), ["r1"], 25, undefined).responses[0].errorType, "Sign Error");
  assert.equal(applyGroupScore(test1("Sign Error"), ["r1"], 25, "Graphing Error").responses[0].errorType, "Graphing Error");
  assert.equal(applyGroupScore(test1("Sign Error"), ["r1"], 100, "").responses[0].errorType, "", "full credit is never an error");
  assert.equal(applyGroupScore(test1(undefined), ["r1"], 25, "").responses[0].errorType, undefined, "nothing stored stays nothing");
});

test("(b) the pre-teach focus holds only while the Focus skill is the cell's weakest standard", () => {
  assert.match(planning, /const preteach = preteachAt && standard === preteachAt\.standard\.code \? preteachAt : null;/);
  // The banner and the request both read `preteach`.
  assert.match(planning, /\{preteach && \(\s*<div className="reteach-context preteach-context">/);
  assert.match(planning, /\.\.\.\(preteach\s*\?\s*\{\s*intent: "preteach" as const,/);
});

test("(c) the share notes say what to do", () => {
  const share = readFileSync("components/teacher-assessments.tsx", "utf8");
  assert.match(share, /share this test\. To use it in\{" "\}\s*\{gradingModeOf\(a\) === "sbg" \? "a Percentage" : "a Standards-Based"\} class, upload it again as a new test\./);
  const setup = readFileSync("components/teacher-scan.tsx", "utf8");
  assert.match(setup, /share this test\. To use it in\{" "\}\s*\{gradingMode === "sbg" \? "a Percentage" : "a Standards-Based"\} class, upload it again there as a new test\./);
});

test("(d) a lesson plan saves with no student or group selected", () => {
  const save = planning.slice(planning.indexOf("async function saveLesson("), planning.indexOf("async function generateAI("));
  assert.match(save, /if \(!s \|\| !content\) return;/);
  assert.doesNotMatch(save, /group\.length/);
  assert.doesNotMatch(planning, /disabled=\{busy \|\| !date \|\| !group\.length\}|disabled=\{busy \|\| aiBusy \|\| !date \|\| !group\.length\}/, "neither Save button waits on a student");
  assert.doesNotMatch(planning, /Choose the student or group this plan is for before saving\./);
  assert.match(planning, /: "Whole class"\}/, "a saved plan for nobody in particular says whole class");
});
