// #126 round 3 (items 1a and 1c; Ricky's question 8, 12 Oct).
//
// "Grade on their own" used to live only in the card's memory. So:
//   - the green bar's "Confirm N" still counted a pulled-out student, and one
//     tap confirmed him at 100% while his own credit form was open (1a);
//   - once graded, answers regroup by (answer, credit): a pulled-out student
//     given the same credit as his old group merged straight back in, and
//     "Change" on that group then regraded him too (1c);
//   - a student whose answer was read as blank sat in the "(blank)" group, and
//     pulled out was asked to grade "blank".
// Now the separation is stored on the answer (gradedAlone) and every path --
// the grouping, the bar, the summary's confirm, the analysis gate -- reads it.
import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const r = buildSync({ entryPoints: ["lib/teacher-workflow.ts"], bundle: true, platform: "node", format: "cjs", write: false });
const m = { exports: {} };
new Function("module", "exports", r.outputFiles[0].text)(m, m.exports);
const { groupAnswers, autoGradedToConfirm, matchesToConfirm, answersToDecide, applyGroupScore, setGradedAlone } = m.exports;

const q = { id: "q8", number: 8, text: "", passage: "", answer: "15", standard: "", secondary: "", skill: "", dok: 1, alignment: 90, confidence: 90, level: "On grade", reasoning: "", verified: true, excluded: false };
const resp = (id, answer, extra = {}) => ({
  id, studentId: "s" + id, questionId: "q8", answer, finalAnswer: answer,
  correct: answer === "15", match: answer === "15" ? 100 : 0, confidence: 100, verified: false, misconception: "", ...extra,
});
const assessment = (responses) => ({ id: "a", title: "T", classId: "c", questions: [q], responses, targetStandards: [], status: "Ready" });
const groupOf = (a, id) => groupAnswers(a, "q8").find((g) => g.responseIds.includes(id));

test("1a: a pulled-out student is never confirmed by the green bar or the summary's confirm", () => {
  let a = assessment(Array.from({ length: 12 }, (_, i) => resp(String(i), "15")));
  assert.equal(matchesToConfirm(a, "q8").length, 12);
  a = setGradedAlone(a, "3", true);
  assert.equal(matchesToConfirm(a, "q8").length, 11, "the bar says Confirm 11, not 12");
  assert.ok(!matchesToConfirm(a, "q8").includes("3"));
  assert.ok(!autoGradedToConfirm(a).includes("3"));
  // Confirming everything the bar offers leaves him undecided, and the
  // analysis gate still waits for him.
  const confirmed = applyGroupScore(a, matchesToConfirm(a, "q8"), 100);
  assert.equal(confirmed.responses.find((x) => x.id === "3").verified, false);
  assert.deepEqual(answersToDecide(confirmed), ["3"]);
});

test("1a: the group's own buttons act on the group without him", () => {
  const a = setGradedAlone(assessment(Array.from({ length: 12 }, (_, i) => resp(String(i), "15"))), "3", true);
  const matching = groupAnswers(a, "q8").find((g) => !g.alone);
  assert.equal(matching.responseIds.length, 11);
  assert.ok(!matching.responseIds.includes("3"));
  const alone = groupOf(a, "3");
  assert.equal(alone.alone, true);
  assert.deepEqual(alone.responseIds, ["3"]);
  assert.equal(alone.needsDecision, true, "pulled out to be decided: a decision, even though it matches the key");
});

test("1c: a separated student stays their own group whatever credit they get", () => {
  let a = assessment([resp("b", ""), resp("w", ""), resp("x", "")]);
  // As read: three blanks, one group (the AI read w's answer as blank).
  assert.equal(groupAnswers(a, "q8").length, 1);
  a = setGradedAlone(a, "w", true);
  for (const credit of [0, 50, 100, 0]) {
    a = applyGroupScore(a, ["w"], credit);
    assert.deepEqual(groupOf(a, "w").responseIds, ["w"], "credit " + credit);
  }
  // The blank group graded at the SAME credit as w: still apart (this merged
  // back before).
  a = applyGroupScore(a, groupOf(a, "b").responseIds, 0);
  assert.deepEqual(groupOf(a, "w").responseIds, ["w"]);
  assert.deepEqual(groupOf(a, "b").responseIds.sort(), ["b", "x"]);
});

test("1c: before the fix's field, the same steps merged him back (the reproduction)", () => {
  // The old card kept "apart" in memory only: grade w alone at 0, the group at
  // 0, and they are one group again. Without gradedAlone that still happens --
  // which is exactly why the separation must be stored.
  let a = assessment([resp("b", ""), resp("w", "")]);
  a = applyGroupScore(a, ["w"], 0);
  a = applyGroupScore(a, ["b"], 0);
  assert.equal(groupAnswers(a, "q8").length, 1, "same answer, same credit: one group");
});

test("1c: grading either one never changes the other", () => {
  let a = setGradedAlone(assessment([resp("b", ""), resp("w", ""), resp("x", "")]), "w", true);
  const blankGroup = groupOf(a, "b");
  a = applyGroupScore(a, blankGroup.responseIds, 0);
  assert.equal(a.responses.find((x) => x.id === "w").verified, false, "grading the blank group leaves w alone");
  a = applyGroupScore(a, groupOf(a, "w").responseIds, 100);
  assert.equal(a.responses.find((x) => x.id === "b").match, 0, "grading w leaves the group alone");
  // "Change" on the blank group (regrade it) still leaves w at 100.
  a = applyGroupScore(a, groupOf(a, "b").responseIds, 50);
  assert.equal(a.responses.find((x) => x.id === "w").match, 100);
  assert.equal(a.responses.find((x) => x.id === "b").match, 50);
});

test("1c: a separated student shows their own answer, not the group's", () => {
  let a = assessment([resp("1", "14"), resp("2", "14"), resp("3", "14", { answer: "14 r 1", finalAnswer: "14" })]);
  a = setGradedAlone(a, "3", true);
  assert.equal(groupOf(a, "3").answer, "14 r 1", "what that student wrote");
});

test("1c: a student who wrote anything is never in a blank group", () => {
  // Text that normalizes to nothing (a lone mark) is not a blank.
  for (const mark of [".", ",", ";", ":", "!", " , "]) {
    const a = assessment([resp("b", ""), resp("w", mark)]);
    assert.equal(groupOf(a, "w").responseIds.includes("b"), false, JSON.stringify(mark));
    assert.notEqual(groupOf(a, "w").answer.trim(), "", JSON.stringify(mark) + " shows as written");
  }
  // A final answer read with the written text missing is not a blank either.
  const a = assessment([resp("b", ""), resp("w", "", { finalAnswer: "15" })]);
  assert.equal(groupOf(a, "w").responseIds.includes("b"), false);
});

test("putting a student back into the group (before grading) undoes it", () => {
  let a = assessment([resp("1", "15"), resp("2", "15")]);
  a = setGradedAlone(a, "2", true);
  assert.equal(groupAnswers(a, "q8").length, 2);
  a = setGradedAlone(a, "2", false);
  assert.equal(groupAnswers(a, "q8").length, 1);
  assert.equal(a.responses.find((x) => x.id === "2").gradedAlone, undefined, "no stray false is stored");
});

test("a pulled-out answer is not counted, and not 'clear' in the student view, until it is graded", () => {
  const { studentReview, countsAsGraded } = m.exports;
  let a = assessment([resp("1", "15"), resp("2", "15")]);
  a = setGradedAlone(a, "2", true);
  const r2 = () => a.responses.find((x) => x.id === "2");
  assert.equal(countsAsGraded(a, r2()), false);
  assert.equal(studentReview(a, "s2").clear.length, 0, "the student view's 'Confirm clear answers' skips it");
  a = applyGroupScore(a, ["2"], 100);
  assert.equal(countsAsGraded(a, r2()), true);
});

test("pulled out of a group that was already graded, the answer is the teacher's to decide again", () => {
  let a = assessment([resp("1", ""), resp("2", "")]);
  a = applyGroupScore(a, ["1", "2"], 0);
  a = setGradedAlone(a, "2", true);
  assert.equal(groupOf(a, "2").needsDecision, true);
  assert.equal(groupOf(a, "1").needsDecision, false, "the rest of the group keeps its grade");
  assert.deepEqual(answersToDecide(a), ["2"]);
});
