// The class DOK grid (docs/design/grading-modes-and-dok-grid.md 2.1-2.3, D1):
// standards down the side, DOK 1-4 across, each cell the class's score on that
// standard at that DOK, coloured by level with its recommendation. Made-up
// students and questions only (rule R8).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";

function bundle(path) {
  const r = buildSync({ entryPoints: [path], bundle: true, platform: "node", format: "cjs", write: false });
  const m = { exports: {} };
  new Function("module", "exports", r.outputFiles[0].text)(m, m.exports);
  return m.exports;
}
const { dokGrid, classAnalysis, DOK_LEVELS } = bundle("lib/teacher-class-analysis.ts");

const std = (code) => ({ code, title: "Title " + code, subject: "Math", grade: 4, domain: "", cluster: "", summary: "", skills: [], prerequisites: [], next: [], vocabulary: [], misconception: "", example: "", dok: 2, source: "", framework: "Common Core" });
const catalog = [std("A.1"), std("B.2")];
const students = ["s1", "s2", "s3"].map((id) => ({ id, classId: "c1", name: "Student " + id, color: "#000", notes: "", evidence: [] }));
const q = (id, standard, dok, extra = {}) => ({ id, number: 1, text: "", passage: "", answer: "", standard, secondary: "", skill: "", dok, alignment: 90, confidence: 90, level: "", reasoning: "", verified: true, excluded: false, ...extra });
const r = (studentId, questionId, match, verified = true) => ({ id: studentId + questionId, studentId, questionId, answer: "", correct: match === 100, match, misconception: "", confidence: 90, verified });
const assessment = (questions, responses) => ({
  id: "a1", classId: "c1", title: "Quiz", subject: "Math", grade: 4, framework: "Common Core", createdAt: "", status: "Ready",
  source: "manual", targetStandards: [], answerKeyVerified: true, uploadIds: [], questions, responses,
});

test("one row per standard, the same standards in the same order as the class-analysis cards", () => {
  const a = assessment(
    [q("q1", "A.1", 1), q("q2", "B.2", 2), q("q3", "Z.9", 1)],
    [r("s1", "q1", 100), r("s1", "q2", 0), r("s1", "q3", 100)],
  );
  const { rows } = dokGrid(a, students, catalog);
  assert.deepEqual(rows.map((x) => x.standard.code), classAnalysis(a, students, catalog).map((x) => x.standard.code));
  assert.deepEqual(rows.map((x) => x.standard.code), ["B.2", "A.1"], "weakest first, like the cards; Z.9 is not in the class's standards");
  assert.deepEqual(rows[0].cells.map((c) => c.dok), [1, 2, 3, 4]);
  assert.deepEqual(DOK_LEVELS.map((d) => d.dok), [1, 2, 3, 4]);
});

test("a cell averages each student first, then the class -- verified answers only", () => {
  const a = assessment(
    [q("q1", "A.1", 2), q("q2", "A.1", 2), q("q3", "A.1", 3)],
    [
      r("s1", "q1", 100), r("s1", "q2", 100), // s1: 100 at DOK 2
      r("s2", "q1", 0), // s2: 0 at DOK 2 (one answer)
      r("s3", "q1", 100, false), // not verified: does not count
      r("s1", "q3", 50),
    ],
  );
  const [row] = dokGrid(a, students, catalog).rows;
  const d2 = row.cells[1];
  assert.equal(d2.questions, 2);
  assert.equal(d2.studentsGraded, 2);
  assert.equal(d2.percent, 50, "(100 + 0) / 2 students, not (100+100+0) / 3 answers");
  assert.equal(d2.level.level, "Beginning");
  assert.equal(d2.level.advice, "Reteach Recommended");
  assert.equal(row.cells[2].percent, 50);
});

test("cells read the level from the rounded score, with its recommendation", () => {
  const a = assessment([q("q1", "A.1", 1)], [r("s1", "q1", 69), r("s2", "q1", 70)]);
  const cell = dokGrid(a, students, catalog).rows[0].cells[0];
  assert.equal(cell.percent, 70, "69.5 shows 70");
  assert.equal(cell.level.level, "Approaching");
  assert.equal(cell.level.advice, "Monitor");
  assert.equal(cell.level.tone, "yellow");
});

test("a cell with no questions is empty, and a cell with ungraded questions has no score", () => {
  const a = assessment([q("q1", "A.1", 1), q("q2", "A.1", 4)], [r("s1", "q1", 100), r("s1", "q2", 0, false)]);
  const [row] = dokGrid(a, students, catalog).rows;
  assert.deepEqual(row.cells.map((c) => c.questions), [1, 0, 0, 1]);
  assert.deepEqual(row.cells.map((c) => c.percent), [100, null, null, null]);
  assert.equal(row.cells[1].level, null);
  assert.equal(row.cells[3].studentsGraded, 0, "DOK 4 has a question but nothing graded");
});

test("a question with no DOK is left out of every cell and counted, never read as DOK 1", () => {
  const a = assessment(
    [q("q1", "A.1", 1), q("q2", "A.1", undefined), q("q3", "A.1", null), q("q4", "A.1", 0), q("q5", "A.1", 2, { excluded: true })],
    [r("s1", "q1", 100), r("s1", "q2", 0), r("s1", "q3", 0), r("s1", "q4", 0)],
  );
  const { rows, noDok } = dokGrid(a, students, catalog);
  assert.equal(noDok, 3);
  assert.equal(rows[0].cells[0].questions, 1);
  assert.equal(rows[0].cells[0].percent, 100, "the 0s on DOK-less questions did not land in DOK 1");
  assert.equal(rows[0].cells[1].questions, 0, "an excluded question is not counted");
});

test("Class analysis shows the grid in place of the DOK rows", () => {
  const src = readFileSync("components/teacher-assessments.tsx", "utf8");
  assert.match(src, /<DokGrid \{\.\.\.dokGrid\(a, students, catalog\)\} \/>/);
  assert.match(src, /heading="Costa's levels across this assessment"\s+showDok=\{false\}/);
  assert.doesNotMatch(src, /heading="Depth of knowledge across this assessment"/);
  const grid = readFileSync("components/dok-grid.tsx", "utf8");
  assert.match(grid, /No questions/);
  assert.match(grid, /cell\.level\.advice/);
  assert.match(grid, /MASTERY_LEVELS\.map/);
});
