// A test used by more than one class (review of #202: data-loss risk). Proven
// when:
//   - the test page offers "Remove from this class", which takes the test out
//     of this class only: this class's answers, pages, pile order and the
//     evidence it gave go; every other class keeps the test and all its work;
//   - Delete warns "Used by N classes — deleting it deletes every class's
//     student work";
//   - Class analysis's Costa's levels, its "still being graded" count and its
//     empty-state check count this class's students only;
//   - editing a question says it changes the question for every class.
// Placeholder names only (R8).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";

const ROOT = process.cwd();
function bundle(entry) {
  const r = buildSync({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, absWorkingDir: ROOT });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, () => ({}));
  return m.exports;
}
const C = bundle("lib/teacher-classes.ts");
const view = readFileSync("components/teacher-assessments.tsx", "utf8");

const resp = (id, studentId, q = "q1", verified = true) => ({ id, studentId, questionId: q, answer: "4", correct: true, match: 100, misconception: "", confidence: 90, verified });
const ws = () => ({
  classes: [{ id: "c1", name: "Class A" }, { id: "c2", name: "Class B" }],
  students: [
    { id: "a1", classId: "c1", name: "Ana", color: "#000", evidence: [{ id: "e1", standard: "7.RP.1", score: 100, date: "2026-11-01", source: "T", assessmentId: "t1" }], notes: "" },
    { id: "b1", classId: "c2", name: "Ben", color: "#000", evidence: [{ id: "e2", standard: "7.RP.1", score: 100, date: "2026-11-01", source: "T", assessmentId: "t1" }], notes: "" },
  ],
  assessments: [{
    id: "t1", classId: "c1", classIds: ["c2"], title: "T", subject: "Math", grade: 7, framework: "Common Core", createdAt: "", status: "Ready",
    questions: [{ id: "q1" }], source: "ai", targetStandards: [], uploadIds: ["blank"], answerKeyUploadIds: ["key"],
    responses: [resp("r1", "a1"), resp("r2", "b1")], studentUploadIds: { a1: ["pa"], b1: ["pb"] }, studentOrder: ["a1", "b1"],
  }],
  lessons: [], activeClassId: "c2", settings: {},
});

test("Remove from this class keeps the other class's work and removes only this one's", () => {
  const out = C.removeFromClass(ws(), "t1", "c2");
  const t = out.workspace.assessments[0];
  assert.deepEqual(C.assessmentClassIds(t), ["c1"]);
  assert.deepEqual(t.responses.map((r) => r.id), ["r1"], "Class A's answers stay");
  assert.deepEqual(t.studentUploadIds, { a1: ["pa"] });
  assert.deepEqual(t.studentOrder, ["a1"]);
  assert.deepEqual(t.questions, [{ id: "q1" }], "the questions and key stay");
  assert.deepEqual(out.workspace.students.find((s) => s.id === "b1").evidence, [], "Class B's evidence from it goes");
  assert.equal(out.workspace.students.find((s) => s.id === "a1").evidence.length, 1, "Class A's stays");
  assert.deepEqual(out.uploadIds, ["pb"], "only Class B's pages are deleted -- never the blank test or the key");
  assert.equal(out.answersRemoved, 1);
});

test("removing the home class hands the test to the next class; one class only is Delete", () => {
  const out = C.removeFromClass(ws(), "t1", "c1");
  const t = out.workspace.assessments[0];
  assert.equal(t.classId, "c2");
  assert.deepEqual(t.classIds, []);
  assert.deepEqual(t.responses.map((r) => r.id), ["r2"]);
  const solo = ws();
  solo.assessments[0].classIds = [];
  assert.equal(C.removeFromClass(solo, "t1", "c1"), null, "a test in one class is deleted, not removed");
  assert.equal(C.removeFromClass(ws(), "t1", "c9"), null);
});

test("the test page offers it, and Delete warns when other classes use the test", () => {
  assert.match(view, /\{usedBy\.length > 1 && \(\s*<Action variant="secondary" onClick=\{\(\) => setLeaving\(true\)\}>[\s\S]*?Remove from this class/);
  assert.match(view, /const out = removeFromClass\(w, a\.id, classroom\.id\);/);
  assert.match(view, /Used by \{usedBy\.length\} classes \(\{usedBy\.map\(\(c\) => c\.name\)\.join\(", "\)\}\) — deleting it deletes\s+every class’s student work\./);
});

test("Class analysis counts this class's students only", () => {
  const panel = view.slice(view.indexOf("function ClassAnalysisPanel("), view.indexOf("function ClassAnalysisPanel(") + 6000);
  assert.match(panel, /const own = a\.responses\.filter\(\(r\) => mine\.has\(r\.studentId\)\);\s*const graded = own\.some\(\(r\) => r\.verified\);/, "the empty state");
  assert.match(panel, /const stillGrading = own\.filter\(/, "still being graded");
  assert.match(view, /<CognitiveBreakdown\s+questions=\{a\.questions\}\s+responses=\{own\}\s+heading="Costa's levels across this assessment"/, "Costa's levels");
});

test("editing a question on a shared test says it changes it for every class", () => {
  assert.match(view, /\{edit && usedBy\.length > 1 && \(\s*<p className="review-notice shared-edit-warning"/);
  assert.match(view, /A change here\s+changes the question for all of them, and every class’s answers to it are graded against it\./);
});
