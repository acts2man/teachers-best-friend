// RULE R6 (a teacher's confirmed grade is never silently replaced), gap G18:
// "Replace writing" on an essay the teacher already scored. docs/system-map.md.
//
// This is proven when: scoring new writing for a student whose trait scores
// the teacher confirmed keeps those confirmed scores unless the teacher chose
// "Replace", and the "Replace writing" button asks -- Keep / Replace / Cancel,
// with the count of confirmed scores -- before anything is uploaded or scored.
// On main the confirmed scores were dropped with no question.
//
// Made-up rubric and scores; no student text.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bundle } from "./lib/bundle.mjs";

const W = bundle("lib/teacher-workflow.ts");
const { defaultRubric } = bundle("lib/writing-rubrics.ts");

const essay = () => ({
  id: "a", classId: "c", title: "Essay", subject: "ELA", elaArea: "writing", genre: "informational", grade: 4,
  framework: "California", createdAt: "", status: "Ready", source: "manual", targetStandards: [], uploadIds: [],
  questions: [], rubric: defaultRubric("informational", 4), responses: [],
});
const scores = (a, s, levels) =>
  W.normalizeWritingScores(a, s, levels.map((score, i) => ({ dimensionId: a.rubric[i].id, score, reason: "made up" })));

/** s1 scored 4/3/2 and the teacher confirmed the first two traits; s2 scored and confirmed. */
function scored() {
  let a = essay();
  a = W.replaceWritingResponses(a, "s1", scores(a, "s1", [4, 3, 2]));
  a = W.setWritingScore(a, "s1", a.rubric[0].id, 4);
  a = W.setWritingScore(a, "s1", a.rubric[1].id, 3);
  a = W.replaceWritingResponses(a, "s2", scores(a, "s2", [1, 1, 1]));
  a = W.confirmWritingScores(a, "s2");
  return a;
}
const level = (a, s, dim) => a.responses.find((r) => r.studentId === s && r.questionId === dim);

test("new writing keeps the trait scores the teacher confirmed, and fills only the rest", () => {
  const before = scored();
  const after = W.replaceWritingResponses(before, "s1", scores(before, "s1", [1, 1, 1]));
  const [p, o, c] = before.rubric.map((d) => d.id);
  assert.equal(level(after, "s1", p).rubricScore, 4, "confirmed: kept");
  assert.equal(level(after, "s1", p).verified, true);
  assert.equal(level(after, "s1", o).rubricScore, 3, "confirmed: kept");
  assert.equal(level(after, "s1", c).rubricScore, 1, "not confirmed: the new suggestion");
  assert.equal(level(after, "s1", c).verified, false);
  assert.equal(after.responses.filter((r) => r.studentId === "s1").length, 3, "one row per trait, no duplicates");
  assert.deepEqual(after.responses.filter((r) => r.studentId === "s2"), before.responses.filter((r) => r.studentId === "s2"), "another student untouched");
});

test("Replace, chosen after the question, discards them for fresh unconfirmed suggestions", () => {
  const before = scored();
  const after = W.replaceWritingResponses(before, "s1", scores(before, "s1", [1, 1, 1]), true);
  const mine = after.responses.filter((r) => r.studentId === "s1");
  assert.deepEqual(mine.map((r) => r.rubricScore), [1, 1, 1]);
  assert.ok(mine.every((r) => !r.verified));
});

test("the question counts the confirmed trait scores it would discard", () => {
  const risk = W.confirmedGradesAtRisk(scored(), ["s1"]);
  assert.deepEqual(risk, { answers: 2, students: 1 });
  const text = W.writingReplaceWarning(risk);
  assert.match(text.title, /^Replace 2 confirmed trait scores\?$/);
  assert.equal(text.keep, "Keep my confirmed scores");
  assert.equal(text.cancel, "Cancel");
  assert.equal(W.writingReplaceWarning({ answers: 1, students: 1 }).title, "Replace 1 confirmed trait score?");
});

test('"Replace writing" asks before it uploads, and the answer reaches the merge', () => {
  const src = readFileSync("components/teacher-assessments.tsx", "utf8").replace(/\/\/.*$/gm, "");
  const view = src.slice(src.indexOf("function WritingReview("));
  assert.match(view, /<Action disabled=\{uploading \|\| busy\} onClick=\{chooseWriting\}>/, "the button goes through the question");
  assert.match(view, /function chooseWriting\(\) \{\s*if \(risk\.answers > 0\) setAskReplace\(true\);/);
  assert.match(view, /<ConfirmRescan[\s\S]*?wording=\{writingReplaceWarning\}[\s\S]*?onKeep=\{\(\) => pickFiles\(false\)\}[\s\S]*?onReplace=\{\(\) => pickFiles\(true\)\}/);
  assert.match(view, /replaceWritingResponses\(\s*withFiles,\s*selected,[\s\S]*?replaceConfirmed\.current,\s*\)/);
});

test("the question reads plainly: the count once, no doubled words", () => {
  const { body } = W.writingReplaceWarning({ answers: 2, students: 1 });
  assert.match(body, /^You already confirmed 2 trait scores for this student\./);
  assert.doesNotMatch(body, /confirmed \d+ confirmed/);
});
