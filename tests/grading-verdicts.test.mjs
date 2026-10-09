// PR A: the AI grades one verdict per answer -- match, blank, or other -- and
// no longer guesses a partial score. A "match" is full credit and a "blank" is
// zero, both automatic; anything else is "other", which carries NO AI score and
// must land in Grade by question for the teacher to decide. The live example
// (Ricky/Michael's call): a student who circled both A and C used to get an AI
// 50%; it must now go to the teacher instead.
import test from "node:test";
import assert from "node:assert/strict";
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
const { normalizeRecognizedResponses, groupAnswers } =
  bundle("lib/teacher-workflow.ts");
const { responseMatch } = bundle("lib/teacher-metrics.ts");

function assessment() {
  return {
    id: "a", classId: "c", title: "Verdicts", subject: "Math", grade: 4,
    framework: "California", createdAt: "", status: "Ready", source: "manual",
    targetStandards: [], uploadIds: [],
    questions: [
      { id: "q1", number: 1, text: "", passage: "", answer: "12 cm³", standard: "s",
        secondary: "", skill: "", dok: 2, alignment: 100, confidence: 100, level: "On grade",
        reasoning: "", verified: true, excluded: false },
    ],
    responses: [],
  };
}
const decides = (a, qid) => groupAnswers(a, qid).some((g) => g.needsDecision);

test("a match is full credit, automatic -- no teacher decision", () => {
  const a = assessment();
  a.responses = normalizeRecognizedResponses(a, "s1", [
    { questionId: "q1", answer: "12 cubic cm", verdict: "match" },
  ]);
  const r = a.responses[0];
  assert.equal(r.correct, true);
  assert.equal(r.match, 100);
  assert.equal(responseMatch(r), 100);
  assert.equal(decides(a, "q1"), false, "a clean match settles on its own");
});

test("a blank is zero, but the teacher sees it before it counts", () => {
  const a = assessment();
  a.responses = normalizeRecognizedResponses(a, "s1", [
    { questionId: "q1", answer: "", verdict: "blank" },
  ]);
  const r = a.responses[0];
  assert.equal(r.answer, "");
  assert.equal(r.correct, false);
  assert.equal(r.match, 0);
  // Ricky's rule (8 Oct): never marked blank when the page shows work.
  assert.equal(decides(a, "q1"), true, "a blank waits for the teacher's look");
});

test("an 'other' carries NO AI score and goes to the teacher (the circled-both case)", () => {
  const a = assessment();
  a.responses = normalizeRecognizedResponses(a, "s1", [
    { questionId: "q1", answer: "A and C", verdict: "other" },
  ]);
  const r = a.responses[0];
  assert.equal(r.answer, "A and C", "the written answer is preserved for the teacher to see");
  assert.equal(r.correct, false);
  assert.equal(r.match, undefined, "no AI-guessed partial is stored");
  assert.equal(decides(a, "q1"), true, "it lands in Grade by question for a decision");
});
