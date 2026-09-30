// PR4: Ricky's screen-flow asks.
//
// Two complaints, both about a phone. A success toast landed at the bottom of
// the screen, right on top of the confirm button he was reaching for. And after
// he confirmed the questions, then the key, the app left him on the finished
// step to find the next tab himself. This pins the toast to the top and moves
// the flow on: questions -> answer key -> student work.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync("components/teacher-app.tsx", "utf8");
const assessments = readFileSync("components/teacher-assessments.tsx", "utf8");
const answerKey = readFileSync("components/teacher-answer-key.tsx", "utf8");

// ---------------------------------------------------------------
// Toasts at the top, clear of the buttons
// ---------------------------------------------------------------

test("toasts render at the top of the screen, not the bottom", () => {
  assert.match(app, /<Toaster position="top-center"/);
  assert.doesNotMatch(app, /position="bottom-right"/);
});

// ---------------------------------------------------------------
// Confirming questions moves to the answer key
// ---------------------------------------------------------------

test("confirming the clear matches advances to the answer key once all reviewed", () => {
  // The bulk-confirm handler computes whether every question is now reviewed
  // and, if so, moves to the key tab.
  assert.match(assessments, /const allReviewed = questions\.every\(/);
  assert.match(assessments, /if \(saved && allReviewed\) setTab\("key"\)/);
});

test("a continue button is offered when questions are reviewed one by one", () => {
  assert.match(assessments, /Continue to answer key/);
  assert.match(assessments, /questionsReviewed[\s\S]*setTab\("key"\)/);
});

// ---------------------------------------------------------------
// Confirming the answer key moves to student work
// ---------------------------------------------------------------

test("the answer key review takes an onConfirmed callback and fires it", () => {
  assert.match(answerKey, /onConfirmed\?\: \(\) => void/);
  assert.match(answerKey, /onConfirmed\?\.\(\)/);
});

test("confirming the key advances to the student-work tab", () => {
  assert.match(
    assessments,
    /<AnswerKeyReview[\s\S]*?onConfirmed=\{\(\) => setTab\("responses"\)\}/,
  );
});
