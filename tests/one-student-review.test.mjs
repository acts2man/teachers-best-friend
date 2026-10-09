// Batch 5 (Michael's one-student-at-a-time review):
//  1. credit (No credit / Half / Full) is given right on the card, no detour
//     into a detail view before confirming;
//  2. the student's photo is not shown automatically -- "See their work" is one
//     tap away;
//  3. an answer the AI matched to the key counts WITHOUT a second confirmation,
//     unless the teacher opens it to change something. This must not weaken the
//     Unsure group or the never-auto-score-blank rule from #108.
import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
function bundle(p) {
  const r = buildSync({
    entryPoints: [p], bundle: true, platform: "node", format: "cjs", write: false,
    alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
  });
  const shim = { exports: {} };
  new Function("module", "exports", r.outputFiles[0].text)(shim, shim.exports);
  return shim.exports;
}
const W = bundle("lib/teacher-workflow.ts");

const q = (id, number, extra = {}) => ({
  id, number, text: "q" + number, passage: "", answer: "42", standard: "4.NBT.4", secondary: "",
  skill: "", dok: 1, alignment: 100, confidence: 100, level: "On grade", reasoning: "",
  verified: true, excluded: false, ...extra,
});
// A clean AI match: correct, full match, read confidently, non-blank, unverified.
const match = (id, sid, qid, extra = {}) => ({
  id, studentId: sid, questionId: qid, answer: "42", correct: true, match: 100,
  misconception: "", confidence: 95, verified: false, ...extra,
});
const assessment = (questions, responses, extra = {}) => ({
  id: "a1", classId: "c1", title: "Quiz", subject: "Math", grade: 4, framework: "CCSS",
  createdAt: "", status: "Ready", source: "scan", targetStandards: ["4.NBT.4"], answerKeyVerified: true,
  uploadIds: [], studentUploadIds: {}, questions, responses, ...extra,
});

// ---------------------------------------------------------------
// Item 3: what counts without a second confirmation
// ---------------------------------------------------------------

test("a clean AI match counts without being confirmed", () => {
  const a = assessment([q("q1", 1)], [match("r1", "s1", "q1")]);
  assert.equal(W.isCleanAiMatch(a, a.responses[0]), true);
  assert.equal(W.countsAsGraded(a, a.responses[0]), true);
});

test("a blank, an unsure read and a wrong answer still need the teacher (#108 preserved)", () => {
  const a = assessment([q("q1", 1), q("q2", 2), q("q3", 3)], [
    match("blank", "s1", "q1", { answer: "", correct: false }),      // never auto-scored
    match("unsure", "s1", "q2", { confidence: 20, correct: false }), // Unsure group
    match("wrong", "s1", "q3", { correct: false, match: 0 }),        // wrong
  ]);
  for (const r of a.responses) {
    assert.equal(W.isCleanAiMatch(a, r), false, r.id + " is not a clean match");
    assert.equal(W.countsAsGraded(a, r), false, r.id + " does not count unconfirmed");
  }
});

test("a confirmed answer always counts, at whatever credit the teacher gave", () => {
  const a = assessment([q("q1", 1)], [match("r1", "s1", "q1", { verified: true, match: 50, correct: false })]);
  assert.equal(W.countsAsGraded(a, a.responses[0]), true, "the teacher's decision counts");
});

test("an answer on an excluded question never counts", () => {
  const a = assessment([q("q1", 1, { excluded: true })], [match("r1", "s1", "q1")]);
  assert.equal(W.isCleanAiMatch(a, a.responses[0]), false);
});

// ---------------------------------------------------------------
// studentReview: score, completion and "needs grading" use the clean matches
// ---------------------------------------------------------------

test("clean matches score and complete the student without a confirmation tap", () => {
  const a = assessment([q("q1", 1), q("q2", 2)], [match("r1", "s1", "q1"), match("r2", "s1", "q2")]);
  const review = W.studentReview(a, "s1");
  assert.equal(review.score, 100, "both clean matches count toward the score");
  assert.equal(review.complete, true, "the student is complete with nothing left to tap");
  assert.equal(review.needsGrading, 0, "a clean match is not 'waiting'");
});

test("a student with one match and one blank is scored but not complete, and the blank still waits", () => {
  const a = assessment([q("q1", 1), q("q2", 2)], [
    match("r1", "s1", "q1"),
    match("blank", "s1", "q2", { answer: "", correct: false }),
  ]);
  const review = W.studentReview(a, "s1");
  assert.equal(review.complete, false, "the blank keeps it incomplete");
  assert.equal(review.needsGrading, 1, "the blank still needs the teacher");
  // The match contributes; the blank is NOT scored as a zero.
  assert.equal(review.score, 100, "score is over what actually counts, blank excluded");
});

// ---------------------------------------------------------------
// gradebook: a clean match prints its points, consistent with the screen
// ---------------------------------------------------------------

test("the gradebook counts a clean match (consistent with the on-screen score)", () => {
  const a = assessment([q("q1", 1), q("q2", 2)], [match("r1", "s1", "q1"), match("r2", "s1", "q2")]);
  const csv = W.gradebookCsv(a, [{ id: "s1", name: "Pupil 1" }]);
  const row = csv.split("\n").find((l) => l.includes("Pupil 1"));
  assert.ok(!row.includes("Incomplete"), "an all-clean-matches student is a final score, not Incomplete");
  assert.match(row, /"100"/, "the score prints");
});

// ---------------------------------------------------------------
// Component wiring (source assertions)
// ---------------------------------------------------------------

const review = readFileSync("components/teacher-review.tsx", "utf8");

test("credit buttons are on the card itself (no detail-view detour)", () => {
  assert.match(review, /function giveCredit\(/, "a give-credit-here handler exists");
  assert.match(review, /className="review-credit"/, "the credit controls render on the card");
  assert.match(review, /CREDIT_LEVELS\.map/, "No credit / Half / Full are the options");
  assert.match(review, /applyGroupScore\(a, \[r\.id\]/, "it grades just this one answer");
});

test("the photo is not shown automatically; 'See their work' is one tap away", () => {
  assert.match(review, /See their work/);
  assert.match(review, /setShowWork\(true\)/, "the photo opens only on tap");
  // The viewer is rendered only when showWork is on -- never inline on the card.
  assert.match(review, /showWork && files\.length > 0/);
});

test("a clean match reads as counted, not as a confirm nag", () => {
  assert.match(review, /Matches your key/);
  assert.match(review, /countsAsGraded\(a, r\)/);
});

test("the detail sheet is still reachable to change an answer", () => {
  assert.match(review, /onClick=\{\(\) => onEdit\(\{ \.\.\.r \}\)\}/, "Edit still opens the detail sheet");
});
