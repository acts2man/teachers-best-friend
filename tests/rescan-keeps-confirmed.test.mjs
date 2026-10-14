// Gap G5 (docs/system-map.md): re-scanning a student replaced the grades the
// teacher had already confirmed, with no warning. mergeStudentResponses kept
// a prior answer only when the new pass found nothing, so a re-read of the
// same page overwrote a confirmed grade with an unconfirmed one -- and lost
// the teacher's credit, error type and "grade on its own" with it.
//
// Now a confirmed answer is never replaced by a scan: it is kept as the
// teacher left it, and the save says how many were kept. Unconfirmed answers
// still take the new read. Made-up data only (rule R8).
import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

function bundle(path) {
  const r = buildSync({ entryPoints: [path], bundle: true, platform: "node", format: "cjs", write: false });
  const m = { exports: {} };
  new Function("module", "exports", r.outputFiles[0].text)(m, m.exports);
  return m.exports;
}
const { applyScannedGroups } = bundle("lib/teacher-class-scan.ts");
const { mergeStudentResponses } = bundle("lib/teacher-workflow.ts");

const q = (id, n) => ({ id, number: n, text: "Q" + n, passage: "", answer: String(n * 10), standard: "7.RP.3", secondary: "", skill: "", dok: 1, alignment: 100, confidence: 100, level: "On grade", reasoning: "", verified: true, excluded: false });
const student = { id: "s1", classId: "c1", name: "Ana Ruiz", color: "#000", evidence: [], notes: "" };
// The teacher confirmed q1 at half credit with an error type, graded on its
// own; q2 was read but never confirmed.
const confirmed = { id: "r-q1", studentId: "s1", questionId: "q1", answer: "12", finalAnswer: "12", correct: false, match: 50, misconception: "", confidence: 90, verified: true, errorType: "Calculation error", gradedAlone: true };
const unconfirmed = { id: "r-q2", studentId: "s1", questionId: "q2", answer: "7", finalAnswer: "7", correct: false, match: 0, misconception: "", confidence: 80, verified: false };
const assessment = {
  id: "a1", classId: "c1", title: "Quiz", subject: "Math", grade: 7, framework: "California", createdAt: "", status: "Ready",
  source: "manual", targetStandards: ["7.RP.3"], answerKeyVerified: true, questions: [q("q1", 1), q("q2", 2)],
  responses: [confirmed, unconfirmed], uploadIds: ["old-page"], studentUploadIds: { s1: ["old-page"] },
};
// The same student scanned again: the model reads both answers afresh.
const rescan = [{
  studentId: "s1", name: "Ana Ruiz", pageUploadIds: ["new-page"],
  responses: [
    { questionId: "q1", answer: "10", finalAnswer: "10", verdict: "match" },
    { questionId: "q2", answer: "20", finalAnswer: "20", verdict: "match" },
  ],
}];

test("G5: a re-scan keeps the grade the teacher confirmed, exactly as they left it", () => {
  const result = applyScannedGroups(assessment, [student], "c1", rescan);
  const q1 = result.assessment.responses.find((r) => r.studentId === "s1" && r.questionId === "q1");
  assert.equal(q1.answer, "12", "the confirmed answer is not replaced by the new read");
  assert.equal(q1.verified, true);
  assert.equal(q1.match, 50, "the teacher's credit stays");
  assert.equal(q1.errorType, "Calculation error");
  assert.equal(q1.gradedAlone, true);
});

test("an answer the teacher had not confirmed still takes the new read", () => {
  const result = applyScannedGroups(assessment, [student], "c1", rescan);
  const q2 = result.assessment.responses.find((r) => r.studentId === "s1" && r.questionId === "q2");
  assert.equal(q2.answer, "20");
});

test("the save says how many confirmed grades were kept", () => {
  assert.equal(applyScannedGroups(assessment, [student], "c1", rescan).keptConfirmed, 1);
  const fresh = { ...assessment, responses: [] };
  assert.equal(applyScannedGroups(fresh, [student], "c1", rescan).keptConfirmed, 0);
});

test("the single-student scan path keeps confirmed grades too", () => {
  const merged = mergeStudentResponses([confirmed, unconfirmed], [
    { ...confirmed, id: "new-1", answer: "10", match: 100, verified: false, errorType: undefined, gradedAlone: undefined },
    { ...unconfirmed, id: "new-2", answer: "20" },
  ]);
  assert.equal(merged[0], confirmed);
  assert.equal(merged[1].answer, "20");
});

test("a re-scan in two piles for the same student (fronts, then backs) still keeps the confirmed grade", () => {
  const twoPiles = [
    { ...rescan[0], pageUploadIds: ["front"] },
    { ...rescan[0], pageUploadIds: ["back"], responses: [{ questionId: "q1", answer: "11", finalAnswer: "11", verdict: "other" }, { questionId: "q2", answer: "", finalAnswer: "", verdict: "blank" }] },
  ];
  const result = applyScannedGroups(assessment, [student], "c1", twoPiles);
  const q1 = result.assessment.responses.find((r) => r.studentId === "s1" && r.questionId === "q1");
  assert.equal(q1, confirmed, "not replaced, and not turned into a two-pages conflict");
  assert.equal(result.keptConfirmed, 1, "counted once");
});
