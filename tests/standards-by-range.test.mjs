// Batch 5 (Ricky): tag a block of questions with one standard -- "1-5 are this
// standard, 6-10 are that one" -- then confirm all, straight to the answer key.
// Built onto #109's speed lane.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";
import path from "node:path";

const ROOT = process.cwd();
function bundle(p) {
  const r = buildSync({ entryPoints: [p], bundle: true, platform: "node", format: "cjs", write: false,
    alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") } });
  const m = { exports: {} };
  new Function("module", "exports", r.outputFiles[0].text)(m, m.exports);
  return m.exports;
}
const W = bundle("lib/teacher-workflow.ts");

const q = (number, extra = {}) => ({
  id: "q" + number, number, text: "q" + number, passage: "", answer: "a", standard: "", secondary: "",
  skill: "", dok: 1, alignment: 0, confidence: 100, level: "", reasoning: "", verified: false, excluded: false, ...extra,
});
const assess = (questions) => ({
  id: "a1", classId: "c1", title: "Q", subject: "Math", grade: 4, framework: "CCSS", createdAt: "",
  status: "Needs review", source: "scan", targetStandards: [], answerKeyVerified: true,
  uploadIds: [], studentUploadIds: {}, responses: [], questions,
});

test("assigns the standard to the inclusive range, clearing alignment to 'teacher chose'", () => {
  const a = assess([q(1, { alignment: 70 }), q(2), q(3), q(4), q(5)]);
  const next = W.assignStandardToRange(a, 1, 3, "4.NBT.4");
  assert.deepEqual(next.questions.map((x) => x.standard), ["4.NBT.4", "4.NBT.4", "4.NBT.4", "", ""]);
  // In-range questions are the teacher's choice now: alignment cleared to 0.
  assert.equal(next.questions[0].alignment, 0);
  assert.equal(W.alignmentIsStrong(next.questions[0]), true, "a teacher-chosen standard reads strong");
});

test("the next block tags only its range, leaving the first alone", () => {
  let a = assess([q(1), q(2), q(3), q(4), q(5), q(6)]);
  a = W.assignStandardToRange(a, 1, 3, "S1");
  a = W.assignStandardToRange(a, 4, 6, "S2");
  assert.deepEqual(a.questions.map((x) => x.standard), ["S1", "S1", "S1", "S2", "S2", "S2"]);
});

test("from/to order doesn't matter, and excluded questions are left out", () => {
  const a = assess([q(1), q(2, { excluded: true }), q(3)]);
  const next = W.assignStandardToRange(a, 3, 1, "S"); // reversed
  assert.equal(next.questions[0].standard, "S");
  assert.equal(next.questions[1].standard, "", "excluded question untouched");
  assert.equal(next.questions[2].standard, "S");
});

test("an empty standard is a no-op", () => {
  const a = assess([q(1)]);
  assert.equal(W.assignStandardToRange(a, 1, 1, "").questions[0].standard, "");
});

test("after tagging a range, confirm-all can finish every question", () => {
  let a = assess([q(1), q(2), q(3)]);
  a = W.assignStandardToRange(a, 1, 3, "S1");
  const { assessment: confirmed, confirmed: n, missingStandard } = W.confirmAllQuestions(a);
  assert.equal(n, 3);
  assert.equal(missingStandard, 0, "all have a standard now, so nothing is left");
  assert.equal(confirmed.status, "Ready");
});

// ---- UI wiring --------------------------------------------------------------
test("the speed lane offers a range control that tags and sets up the next block", () => {
  const ui = readFileSync("components/teacher-assessments.tsx", "utf8");
  assert.match(ui, /className="range-assign"/);
  assert.match(ui, /assignStandardToRange\(a, from, to, rangeStandard\)/);
  assert.match(ui, /setRangeFrom\(String\(hi \+ 1\)\)/, "the next block starts after this one");
  // "Looks good — confirm all" still goes straight to the answer key.
  assert.match(ui, /Looks good — confirm all/);
  assert.match(ui, /setTab\("key"\)/);
});
