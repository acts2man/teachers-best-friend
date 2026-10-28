// The DOK grid's cell panel (D2; docs/design/grading-modes-and-dok-grid.md
// 2.4-2.6) with Ricky's and Michael's answers (20 Oct 2026):
//   - the recommendation comes from the score alone;
//   - an extension always aims one DOK level up (DOK 4 stays at 4);
//   - ELA common errors use Michael's reading and writing lists.
// The lesson it opens is pitched at the chosen DOK level(s) and aimed at the
// cell's common error types -- names from the fixed lists and counts only;
// nothing a student or teacher wrote reaches the AI. Made-up data only (R8).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
function bundle(entry) {
  const r = buildSync({
    entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, absWorkingDir: ROOT,
    alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}
const { errorTypesFor, ALL_ERROR_TYPES } = bundle("lib/error-types.ts");
const { dokGrid, dokCellDetail, nextStepDok, lessonFocus } = bundle("lib/teacher-class-analysis.ts");
const { masteryLevel } = bundle("lib/mastery-levels.ts");
const { buildPrompt } = bundle("lib/analyze-shared.ts");

test("Michael's ELA lists, by area; Language has none yet", () => {
  assert.deepEqual(errorTypesFor("ELA", "reading"), [
    "Main Idea / Central Idea", "Supporting Evidence", "Literal Recall / Key Details", "Vocabulary in Context",
    "Text Structure", "Author's Purpose / Point of View", "Connections / Relationships", "Summarization",
  ]);
  assert.deepEqual(errorTypesFor("ELA", "writing"), [
    "Weak Focus / Main Idea", "Insufficient Development", "Weak Evidence", "Organization",
    "Sentence Construction", "Grammar / Usage", "Punctuation / Capitalization", "Spelling / Word Form",
  ]);
  assert.deepEqual(errorTypesFor("ELA", "language"), []);
  assert.equal(ALL_ERROR_TYPES.length, 8 + 8 + 8);
});

test("an extension aims one DOK level up; DOK 4 stays at 4; every other step stays", () => {
  const exceeding = masteryLevel(95);
  assert.equal(nextStepDok(exceeding, 2), 3);
  assert.equal(nextStepDok(exceeding, 4), 4);
  for (const p of [40, 75, 85]) assert.equal(nextStepDok(masteryLevel(p), 2), 2);
});

const std = (code) => ({ code, title: "Title " + code, subject: "Math", grade: 4, domain: "", cluster: "", summary: "", skills: [], prerequisites: [], next: [], vocabulary: [], misconception: "", example: "", dok: 2, source: "", framework: "Common Core" });
const students = ["s1", "s2", "s3", "s4"].map((id) => ({ id, classId: "c1", name: "Student " + id, color: "#000", notes: "", evidence: [] }));
const q = (id, standard, dok) => ({ id, number: Number(id.slice(1)), text: "", passage: "", answer: "", standard, secondary: "", skill: "", dok, alignment: 90, confidence: 90, level: "", reasoning: "", verified: true, excluded: false });
const r = (studentId, questionId, match, extra = {}) => ({ id: studentId + questionId, studentId, questionId, answer: "", correct: match === 100, match, misconception: "", confidence: 90, verified: true, ...extra });
const math = {
  id: "a1", classId: "c1", title: "Quiz", subject: "Math", grade: 4, framework: "Common Core", createdAt: "", status: "Ready", source: "manual",
  targetStandards: [], answerKeyVerified: true, uploadIds: [],
  questions: [q("q1", "A.1", 2), q("q2", "A.1", 2), q("q3", "A.1", 3)],
  responses: [
    r("s1", "q1", 0, { errorType: "Sign Error", finalAnswer: "-12" }),
    r("s2", "q1", 0, { errorType: "Sign Error", finalAnswer: "-12" }),
    r("s3", "q2", 0, { errorType: "Setup/Method Error", finalAnswer: "7" }),
    r("s4", "q2", 0, { errorType: "Not on any list", finalAnswer: "7" }),
    r("s4", "q1", 0, { errorType: "Sign Error", verified: false }), // not confirmed: not counted
    r("s1", "q3", 100),
  ],
};

test("the panel's common errors: tagged types from the list, most common first; else the most common wrong answers", () => {
  const [row] = dokGrid(math, students, [std("A.1")]).rows;
  const d2 = row.cells[1];
  assert.deepEqual(d2.questionIds, ["q1", "q2"]);
  const detail = dokCellDetail(math, students, d2.questionIds);
  assert.deepEqual(detail.errorTypes.map((t) => [t.errorType, t.count]), [["Sign Error", 2], ["Setup/Method Error", 1]]);
  assert.deepEqual(detail.errorTypes[0].students.map((s) => s.id), ["s1", "s2"]);
  const untagged = { ...math, responses: math.responses.map((x) => ({ ...x, errorType: "" })) };
  assert.deepEqual(dokCellDetail(untagged, students, d2.questionIds).wrongAnswers, [{ answer: "-12", count: 2 }, { answer: "7", count: 2 }]);
});

test("ELA reading tags read Michael's list", () => {
  const ela = { ...math, subject: "ELA", elaArea: "reading", responses: [r("s1", "q1", 0, { errorType: "Supporting Evidence" }), r("s2", "q1", 0, { errorType: "Sign Error" })] };
  assert.deepEqual(dokCellDetail(ela, students, ["q1"]).errorTypes.map((t) => t.errorType), ["Supporting Evidence"], "a math type is not on the reading list");
});

test("what a lesson from the grid sends: DOK levels and fixed-list error names with counts, nothing else", () => {
  const focus = lessonFocus(math, "A.1", [3, 2, 2, 9]);
  assert.deepEqual(focus, { dok: [2, 3], errorTypes: [{ name: "Sign Error", count: 2 }, { name: "Setup/Method Error", count: 1 }] });
  assert.equal(JSON.stringify(focus).includes("Student"), false, "no student in it");
  assert.equal(JSON.stringify(focus).includes("-12"), false, "no answer in it");
});

const w = { assessments: [], students: [], classes: [], lessons: [], customStandards: [std("A.1")], sharedStandards: [] };
const catalog = [std("A.1")];
const lesson = (extra) =>
  buildPrompt({ mode: "lesson", standard: "A.1", grade: 4, framework: "Common Core", text: "", duration: 15, modality: "Visual", ...extra }, w, catalog, true).task;

test("the lesson prompt is pitched at the DOK level and aimed at the errors; a name not on a list never gets in", () => {
  const plain = lesson({ intent: "reteach" });
  assert.doesNotMatch(plain, /Depth of Knowledge|most common mistakes/, "no DOK, no errors: the prompt is as before");
  const one = lesson({ intent: "reteach", dok: [2], errorTypes: [{ name: "Sign Error", count: 2 }, { name: "Setup/Method Error", count: 1 }] });
  assert.match(one, /DOK 1 is recall and reproduction/);
  assert.match(one, /exit questions at DOK 2\./);
  assert.match(one, /The most common mistakes on this standard at that depth were: Sign Error \(2 answers\), Setup\/Method Error \(1 answer\)\./);
  const two = lesson({ intent: "extension", dok: [3, 4] });
  assert.match(two, /across DOK 3, 4, easiest first/);
  const sneaky = lesson({ dok: [2], errorTypes: [{ name: "Maria Lopez wrote 7", count: 3 }, { name: "Sign Error", count: 1 }] });
  assert.doesNotMatch(sneaky, /Maria|wrote 7/);
  assert.match(sneaky, /Sign Error \(1 answer\)/);
});

test("the grid opens the panel, the panel opens the lesson, the lesson sends the focus", () => {
  const grid = readFileSync("components/dok-grid.tsx", "utf8");
  assert.match(grid, /role="button"\s+tabIndex=\{0\}\s+onClick=\{onOpen\}/);
  assert.match(grid, /<DokCellPanel/);
  const panel = readFileSync("components/dok-cell-panel.tsx", "utf8");
  assert.match(panel, /const target = nextStepDok\(level, cell\.dok\);/);
  assert.match(panel, /"&intent=" \+\s+level\.nextStep\.intent \+\s+"&dok=" \+\s+doks\.join\(","\)/);
  assert.match(panel, /\{level\.nextStep\.label\} DOK \{target\}/);
  const planning = readFileSync("components/teacher-planning.tsx", "utf8");
  assert.match(planning, /lessonFocus\(sourceAssessment, standard, dokLevels, errorsFrom\)/);
  assert.match(planning, /\.\.\.\(focus \? \{ dok: focus\.dok, errorTypes: focus\.errorTypes \} : \{\}\)/);
});
