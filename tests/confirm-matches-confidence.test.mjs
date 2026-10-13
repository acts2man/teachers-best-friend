// PR 3 review: the green "Confirm N answers that match the key" settles answers
// without the teacher looking at them, so it may only take CLEAN matches -- the
// same >=90% reading confidence the rest of the app requires (isCleanAiMatch).
// A match read at 50-89% is a group the teacher decides instead.
import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const r = buildSync({ entryPoints: ["lib/teacher-workflow.ts"], bundle: true, platform: "node", format: "cjs", write: false });
const m = { exports: {} };
new Function("module", "exports", r.outputFiles[0].text)(m, m.exports);
const { groupAnswers, autoGradedToConfirm, matchesToConfirm, answersToDecide, confirmResponses, CLEAN_READ } = m.exports;

const q = { id: "q1", number: 1, text: "", passage: "", answer: "12", standard: "7.RP.3", secondary: "", skill: "", dok: 1, alignment: 90, confidence: 90, level: "On grade", reasoning: "", verified: true, excluded: false };
const resp = (id, confidence, extra = {}) => ({ id, studentId: "s" + id, questionId: "q1", answer: "12", finalAnswer: "12", correct: true, match: 100, confidence, verified: false, misconception: "", ...extra });
const assessment = (responses) => ({ id: "a", title: "T", classId: "c", questions: [q], responses, targetStandards: [], status: "Ready" });

test("the threshold is the clean-match one", () => assert.equal(CLEAN_READ, 90));

test("a confident match is confirmed by the green button and needs no decision", () => {
  const a = assessment([resp("1", 100), resp("2", 95)]);
  assert.deepEqual(autoGradedToConfirm(a), ["1", "2"]);
  assert.equal(groupAnswers(a, "q1").some((g) => g.needsDecision), false);
});

test("a match read at 50-89% is never confirmed unseen: its group needs the teacher", () => {
  for (const c of [50, 70, 89]) {
    const a = assessment([resp("1", 100), resp("2", c)]);
    assert.deepEqual(autoGradedToConfirm(a), ["1"], "confidence " + c);
    assert.deepEqual(matchesToConfirm(a, "q1"), ["1"]);
    const g = groupAnswers(a, "q1");
    // Its own group (#126 review): the confident read stays a clean match.
    assert.equal(g.length, 2, "the shaky read is kept apart from the confident one");
    assert.equal(g.find((x) => !x.lowConfidence).needsDecision, false);
    assert.equal(g.find((x) => x.lowConfidence).needsDecision, true, "confidence " + c + " is the teacher's call");
  }
});

test("#126 review: 23 clean matches + 1 read at 70% -> 23 to confirm, 1 to decide; analysis stays blocked until it is decided", () => {
  const rs = Array.from({ length: 23 }, (_, i) => resp(String(i), 100)).concat(resp("x", 70));
  const a = assessment(rs);
  const groups = groupAnswers(a, "q1");
  assert.equal(groups.find((g) => !g.lowConfidence).responseIds.length, 23);
  assert.equal(groups.find((g) => !g.lowConfidence).needsDecision, false, "not '0 correct, 24 need review'");
  assert.deepEqual(matchesToConfirm(a, "q1").length, 23);
  assert.deepEqual(answersToDecide(a), ["x"]);
  // One tap on "Confirm 23": the 70% read is still waiting, so analysis is still blocked.
  const after = confirmResponses(a, matchesToConfirm(a));
  assert.equal(autoGradedToConfirm(after).length, 0);
  assert.deepEqual(answersToDecide(after), ["x"]);
  // The teacher decides it: nothing is left, analysis opens.
  const decided = { ...after, responses: after.responses.map((r) => (r.id === "x" ? { ...r, verified: true } : r)) };
  assert.deepEqual(answersToDecide(decided), []);
});

test("under 50 is still the Unsure group, and confirmed answers are untouched", () => {
  const a = assessment([resp("1", 30), resp("2", 70, { verified: true })]);
  assert.deepEqual(autoGradedToConfirm(a), []);
  const g = groupAnswers(a, "q1");
  assert.equal(g.find((x) => x.unsure)?.needsDecision, true);
  assert.equal(g.find((x) => !x.unsure)?.needsDecision, false, "a confirmed answer is decided");
});
