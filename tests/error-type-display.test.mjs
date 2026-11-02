// Review of #190 (28 Oct 2026): the Class view, the class report and the
// student report count and show only tags on the test's current list -- a
// typed "Other: x" as its label -- and hide off-list tags everywhere, so a tab
// open from before the list changed cannot bring the old Math five back on
// screen by writing them back. Proven when an assessment carrying an old tag
// ("Sign error"), a current one ("Sign Error") and a typed Other label shows
// the current one and the label, and never the old one, in every place.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);
function bundle(entry) {
  const r = buildSync({
    entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, absWorkingDir: ROOT,
    alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}
const E = bundle("lib/error-types.ts");
const C = bundle("lib/teacher-class-analysis.ts");
const W = bundle("lib/teacher-workflow.ts");

const STANDARD = { code: "4.NBT.5", title: "Multiply", grade: 4, subject: "Math", framework: "California", domain: "", cluster: "",
  wording: "Multiply", summary: "", skills: [], prerequisites: [], next: [], vocabulary: [], misconception: "", example: "", dok: 2, source: "" };
const q = (id) => ({ id, number: Number(id.slice(1)), text: "", passage: "", answer: "12", standard: "4.NBT.5", secondary: "", skill: "",
  dok: 2, alignment: 100, confidence: 100, level: "On grade", reasoning: "", verified: true, excluded: false });
const r = (studentId, questionId, errorType) => ({ id: studentId + questionId, studentId, questionId, answer: "7", correct: false,
  match: 0, misconception: "", confidence: 100, verified: true, errorType });
const students = ["s1", "s2", "s3"].map((id) => ({ id, classId: "c", name: "Student " + id, color: "#000", evidence: [], notes: "" }));
const math = {
  id: "a", classId: "c", title: "T", subject: "Math", grade: 4, framework: "California", createdAt: "2026-10-01T00:00:00Z",
  status: "Ready", source: "manual", targetStandards: [], uploadIds: [], questions: [q("q1"), q("q2")],
  responses: [
    r("s1", "q1", "Sign error"), // the old list: written back by a stale tab
    r("s2", "q1", "Sign Error"),
    r("s3", "q1", "Other: forgot to carry"),
    r("s1", "q2", "Wrong formula"), // old
    r("s2", "q2", "Not on any list"),
  ],
};
const OLD = /Sign error|Wrong formula|Not on any list/;

test("shownErrorType: the tag when it is on the current list, else nothing", () => {
  assert.equal(E.shownErrorType(math, "Sign Error"), "Sign Error");
  assert.equal(E.shownErrorType(math, " Other: forgot to carry "), "Other: forgot to carry");
  assert.equal(E.shownErrorType(math, "Sign error"), "");
  assert.equal(E.shownErrorType({ subject: "ELA", elaArea: "language" }, "Sign Error"), "", "a subject with no list shows none");
  assert.equal(E.shownErrorType(math, undefined), "");
});

test("the Class view counts only current-list tags (per standard and for the whole test)", () => {
  const row = C.classAnalysis(math, students, [STANDARD])[0];
  assert.deepEqual(row.errorTypes.map((t) => [t.errorType, t.count]), [["Other: forgot to carry", 1], ["Sign Error", 1]]);
  assert.deepEqual(C.assessmentErrorTypes(math, students).map((t) => t.errorType), ["Other: forgot to carry", "Sign Error"]);
  assert.deepEqual(C.studentErrorTypes(math, "s1"), [], "s1's two tags are both off the list");
});

test("the class report and the student report never print an off-list tag", () => {
  const report = C.classAnalysisReport(math, C.classAnalysis(math, students, [STANDARD]));
  assert.doesNotMatch(report, OLD);
  assert.match(report, /Sign Error \(1\)/);
  assert.match(report, /Other: forgot to carry \(1\)/);
  const s1 = W.studentReport(math, students[0]);
  assert.doesNotMatch(s1, OLD);
  assert.doesNotMatch(s1, /MOST COMMON ERROR TYPES/, "nothing to list for s1");
  const s3 = W.studentReport(math, students[2]);
  assert.match(s3, /MOST COMMON ERROR TYPES\nOther: forgot to carry \(1\)/);
});

test("the grading screen shows a group's tag only when it is on the list", () => {
  const review = readFileSync("components/teacher-review.tsx", "utf8");
  assert.match(review, /const tagged = shownErrorType\(a, g\.errorType\);/);
  assert.match(review, /\{tagged \? " · " \+ tagged : ""\}/, "the graded card");
  assert.match(review, /useState\(tagged \|\| suggested\)/, "the open picker");
  assert.doesNotMatch(review, /g\.errorType \? " · " \+ g\.errorType/);
  // The student's depth breakdown too.
  const breakdown = review.slice(review.indexOf("function StudentDepthBreakdown("));
  assert.match(breakdown, /const t = shownErrorType\(a, r\.errorType\);/);
});
