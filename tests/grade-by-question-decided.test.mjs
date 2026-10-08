// Ricky's live bug: in Grade by question, after giving a group Half or No
// credit, the question kept saying "N to decide" because groupAnswers set
// needsDecision from correct && match>=100 only, ignoring that the teacher had
// verified the group. A group whose responses are all verified is decided, at
// any score.
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
const { groupAnswers, applyGroupScore, autoGradedToConfirm, confirmResponses, creditLabel } =
  bundle("lib/teacher-workflow.ts");

function resp(id, questionId, answer, { match, correct = false, verified = false } = {}) {
  return {
    id, studentId: "s-" + id, questionId, answer,
    correct, match, verified, misconception: "", confidence: 100,
  };
}
function assessment(responses) {
  return {
    id: "a", classId: "c", title: "Volumes and Circles", subject: "Math", grade: 4,
    framework: "California", createdAt: "", status: "Ready", source: "manual",
    targetStandards: [], uploadIds: [],
    questions: [{ id: "q1", number: 1, text: "", passage: "", answer: "62.8", standard: "s",
      secondary: "", skill: "", dok: 2, alignment: 100, confidence: 100, level: "On grade",
      reasoning: "", verified: true, excluded: false }],
    responses,
  };
}
const decideCount = (a) => groupAnswers(a, "q1").filter((g) => g.needsDecision).length;

test("a group verified at 0% or 50% is decided, not 'to decide' (the bug)", () => {
  for (const value of [0, 50]) {
    const a = assessment([
      resp("1", "q1", "60", { match: value, correct: false, verified: true }),
      resp("2", "q1", "60", { match: value, correct: false, verified: true }),
    ]);
    const g = groupAnswers(a, "q1")[0];
    assert.equal(g.verified, true, `verified at ${value}%`);
    assert.equal(g.needsDecision, false, `not to-decide at ${value}%`);
    assert.equal(decideCount(a), 0);
  }
});

test("an unverified partial still needs a decision, and deciding it drops the count", () => {
  const a = assessment([resp("1", "q1", "60", { match: 50, correct: false, verified: false })]);
  assert.equal(decideCount(a), 1, "starts to-decide");
  // The teacher gives Half — applyGroupScore verifies the group.
  const after = applyGroupScore(a, ["1"], 50);
  assert.equal(after.responses[0].verified, true);
  assert.equal(decideCount(after), 0, "count drops the moment it's decided");
});

test("a clean match is decided on its own; a blank waits for the teacher to see it", () => {
  // Ricky's rule (8 Oct): never marked blank when the page shows work. A blank
  // is scored zero but the teacher sees the photo before it is confirmed.
  const a = assessment([
    resp("1", "q1", "62.8", { match: 100, correct: true, verified: false }),
    resp("2", "q1", "", { match: 0, correct: false, verified: false }),
  ]);
  assert.equal(decideCount(a), 1);
});

test("a mixed group (one response unverified) still needs a decision", () => {
  const a = assessment([
    resp("1", "q1", "60", { match: 50, correct: false, verified: true }),
    resp("2", "q1", "60", { match: 50, correct: false, verified: false }),
  ]);
  // A student graded on their own forms their own group (so one can be pulled
  // out of a group); the one still waiting needs a decision.
  const groups = groupAnswers(a, "q1");
  assert.equal(groups.length, 2);
  const waiting = groups.find((g) => !g.verified);
  assert.equal(waiting.needsDecision, true);
});

test("creditLabel names the presets and falls back to a percent", () => {
  assert.equal(creditLabel(0), "No credit");
  assert.equal(creditLabel(50), "Half");
  assert.equal(creditLabel(100), "Full");
  assert.equal(creditLabel(75), "75%");
});

test("autoGradedToConfirm returns the clean-match answers still unconfirmed, and confirmResponses verifies them", () => {
  const a = assessment([
    resp("m", "q1", "62.8", { match: 100, correct: true, verified: false }), // clean match
    resp("b", "q1", "", { match: 0, correct: false, verified: false }), // blank
    resp("p", "q1", "60", { match: 50, correct: false, verified: false }), // partial → NOT auto
    resp("d", "q1", "62.8", { match: 100, correct: true, verified: true }), // already done
  ]);
  const ids = autoGradedToConfirm(a);
  // Clean matches only: a blank is not confirmed in bulk without a look.
  assert.deepEqual(ids.sort(), ["m"]);
  const after = confirmResponses(a, ids);
  assert.equal(after.responses.find((r) => r.id === "m").verified, true);
  assert.equal(after.responses.find((r) => r.id === "b").verified, false);
  assert.equal(after.responses.find((r) => r.id === "p").verified, false, "partial untouched");
});

// --- component wiring ---
const ui = readFileSync("components/teacher-review.tsx", "utf8");

test("decided groups show a Graded chip with the points and a Change control", () => {
  assert.match(ui, /Graded · \{decidedLabel\}/, "shows Graded + points");
  assert.match(ui, /Change/, "offers Change");
  assert.match(ui, /onReopen=\{\(\) => setReopened\(\(p\) => new Set\(p\)\.add\(g\.key\)\)\}/, "Change reopens the controls");
  assert.match(ui, /open=\{g\.needsDecision \|\| reopened\.has\(g\.key\)\}/, "reopened shows the credit controls");
});

test("after the last group it moves to the next question and shows an all-graded state", () => {
  assert.match(ui, /hasWork\(updated, q\.id\)/, "checks the just-saved state");
  assert.match(ui, /setOpenId\(next \? next\.id : null\)/, "advances to the next question with work, or back to the summary");
  assert.match(ui, /All questions graded/, "shows an all-graded state");
  // The confirm-clear step is folded in so the flow is self-contained.
  assert.match(ui, /confirmMatching/, "can confirm matching answers from here");
  assert.match(ui, /GroupWorkSample assessment=\{a\} group=\{g\}/, "a whole-page sample remains for answers with no region");
});
