// Ricky's blocker: a longer test (10 questions / two pages / "read again") came
// back with every question unstandardized and alignment 0, which leaves the
// student-work step locked (preparationGaps needs a standard on each question).
// The model read the questions fine -- it punted on classification for the
// larger set. Two fixes: the assignment prompt now insists on classifying each
// question against the intended standards, and the teacher gets a one-tap way to
// assign an intended standard to whatever came back untagged.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);
function bundle(entry) {
  const r = buildSync({
    entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false,
    absWorkingDir: ROOT,
    alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}
const { questionsMissingStandard, assignStandardToUntagged, preparationGaps } =
  bundle("lib/teacher-workflow.ts");

function q(id, standard, extra = {}) {
  return {
    id, number: 1, text: "Q", passage: "", answer: "A", standard, secondary: "",
    skill: "s", dok: 1, alignment: standard ? 85 : 0, confidence: standard ? 90 : 0,
    level: "On grade", reasoning: "", verified: false, excluded: false, ...extra,
  };
}
function assessment(questions) {
  return {
    id: "a", classId: "c", title: "T", subject: "Math", grade: 7, framework: "California",
    createdAt: "", status: "Needs review", source: "ai", targetStandards: ["7.RP.3"],
    uploadIds: [], responses: [], questions,
  };
}

test("questionsMissingStandard finds the untagged, ignores excluded and tagged", () => {
  const a = assessment([
    q("q1", ""), q("q2", ""), q("q3", "7.RP.3"),
    q("q4", "", { excluded: true }),
  ]);
  assert.deepEqual(questionsMissingStandard(a).map((x) => x.id), ["q1", "q2"]);
});

test("the whole-test-empty case Ricky hit is detected", () => {
  const a = assessment([q("q1", ""), q("q2", ""), q("q3", "")]);
  assert.equal(questionsMissingStandard(a).length, 3);
});

test("assignStandardToUntagged fills only the empty ones, leaving others and verify alone", () => {
  const a = assessment([q("q1", ""), q("q2", "7.RP.3", { verified: true }), q("q3", "")]);
  const after = assignStandardToUntagged(a, "7.RP.3");
  assert.deepEqual(after.questions.map((x) => x.standard), ["7.RP.3", "7.RP.3", "7.RP.3"]);
  // Verification is untouched -- the teacher still confirms each question.
  assert.deepEqual(after.questions.map((x) => x.verified), [false, true, false]);
  // Excluded questions are never touched.
  const b = assignStandardToUntagged(assessment([q("q1", "", { excluded: true })]), "7.RP.3");
  assert.equal(b.questions[0].standard, "");
});

test("assigning a standard is the step that lets the teacher unlock the next step", () => {
  // All-empty read: not ready (no standards).
  const a = assessment([q("q1", ""), q("q2", "")]);
  assert.equal(preparationGaps(a).ready, false);
  // Assign the intended standard + confirm the questions + key -> ready.
  let b = assignStandardToUntagged(a, "7.RP.3");
  b = { ...b, answerKeyVerified: true, questions: b.questions.map((x) => ({ ...x, verified: true })) };
  assert.equal(preparationGaps(b).ready, true);
});

test("the assignment prompt insists on classifying every question, not bailing on long tests", () => {
  const src = readFileSync("lib/analyze-shared.ts", "utf8");
  assert.match(src, /Classify EACH question on its own/);
  assert.match(src, /never leave a whole test unclassified/);
  assert.match(src, /being unsure is not a reason to leave it empty/);
});

test("the assessment review offers a one-tap assign for untagged questions", () => {
  const ui = readFileSync("components/teacher-assessments.tsx", "utf8");
  assert.match(ui, /questionsMissingStandard\(a\)\.length > 0/);
  assert.match(ui, /assignStandardToUntagged\(a, code\)/);
  assert.match(ui, /didn't tag these questions with a standard/);
});
