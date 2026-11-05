// The student super grid (docs/design/super-grids.md section 4; Ricky,
// 22 Oct 2026). Proven when: picking a student shows their own grid -- the
// class grid's rows (standard clusters) and columns (DOK 1-4) -- built from
// every confirmed answer of THEIRS this school year, on their class's tests,
// read in their class's grading mode; a question counts only where they
// answered it, so the question counts (last 30 days vs older), the tests, the
// weakest standards and the error types in a cell are all theirs; another
// student's answers never move it; and nothing calls the AI. Made-up data.
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
const G = bundle("lib/super-grid.ts");
const [E1, E2] = bundle("lib/error-types.ts").errorTypesFor("Math");

const NOW = new Date(2026, 9, 27, 12); // 27 Oct 2026; school year 2026-27
const q = (id, standard, dok, extra = {}) => ({ id, number: 1, text: "", passage: "", answer: "", standard, secondary: "", skill: "", dok, alignment: 90, confidence: 90, level: "", reasoning: "", verified: true, excluded: false, ...extra });
const r = (studentId, questionId, match, extra = {}) => ({ id: studentId + questionId, studentId, questionId, answer: "", correct: match === 100, match, misconception: "", confidence: 90, verified: true, ...extra });
const base = { classId: "c1", subject: "Math", grade: 7, framework: "California", createdAt: "2026-09-01T12:00:00Z", status: "Ready", source: "manual", targetStandards: [], answerKeyVerified: true, uploadIds: [] };
const recent = { ...base, id: "t1", title: "Recent quiz", dateGiven: "2026-10-20",
  questions: [q("a", "7.RP.1", 1), q("b", "7.RP.2", 2), q("c", "7.RP.1", 2), q("nd", "7.RP.1", null), q("x", "7.RP.1", 2, { excluded: true }), q("sec", "7.EE.1", 2, { secondChoice: true, verified: false })],
  responses: [
    r("s1", "a", 100), r("s1", "b", 0, { errorType: E1 }), r("s1", "c", 50, { verified: false }), r("s1", "nd", 50), r("s1", "x", 0), r("s1", "sec", 0),
    r("s2", "a", 0), r("s2", "b", 100), r("s2", "c", 100, { errorType: E2 }),
  ] };
const older = { ...base, id: "t2", title: "Older quiz", dateGiven: "2026-09-10",
  questions: [q("d", "7.RP.2", 2), q("e", "7.EE.1", 3)],
  responses: [r("s1", "d", 50, { errorType: E1 }), r("s1", "e", 25, { errorType: E2 }), r("s2", "d", 100)] };
const onlyOthers = { ...base, id: "t3", title: "Geometry", dateGiven: "2026-10-01", questions: [q("g", "7.G.1", 1)], responses: [r("s2", "g", 100)] };
const lastYear = { ...base, id: "t4", dateGiven: "2026-05-01", questions: [q("a", "7.RP.1", 1)], responses: [r("s1", "a", 0)] };
const otherClass = { ...base, id: "t5", classId: "c2", questions: [q("a", "7.RP.1", 1)], responses: [r("s1", "a", 0)] };
const w = {
  students: [{ id: "s1", classId: "c1" }, { id: "s2", classId: "c1" }],
  assessments: [recent, older, onlyOthers, lastYear, otherClass],
  customStandards: [], sharedStandards: [],
  settings: { teacherName: "", school: "", reduceMotion: false },
};
const pct = { id: "c1", gradingMode: "percentage" };

test("their own grid: the class grid's clusters and DOK columns, from their confirmed answers this school year", () => {
  const grid = G.studentSuperGrid(w, pct, "s1", NOW);
  assert.equal(grid.tests, 2, "the two tests they have answers on: not one only others took, last year's, or another class's");
  assert.deepEqual(grid.rows.map((row) => row.cluster.key), ["7.RP", "7.EE"], "no 7.G row: they never answered it");
  assert.equal(grid.rows[0].label, "Ratios and Proportional Relationships · 7.RP");
  assert.equal(grid.noDok, 1, "the question they answered with no DOK: left out, and counted");
  const [dok1, dok2, dok3] = grid.rows[0].cells;
  assert.deepEqual([dok1.percent, dok1.answers, dok1.questions], [100, 1, 1]);
  // DOK 2: b (0) and d (50). c is unconfirmed, x excluded: neither counts.
  assert.deepEqual([dok2.percent, dok2.answers, dok2.questions], [25, 2, 2]);
  assert.equal(dok3.questions, 0, "Not Tested");
  assert.equal(grid.rows[1].cells[1].questions, 0, "the unchecked second choice never counts");
  assert.equal(grid.rows[1].cells[2].percent, 25);
});

test("the tap panel is theirs: score, questions in the last 30 days vs older, weakest standards, error types", () => {
  const cell = G.studentSuperGrid(w, pct, "s1", NOW).rows[0].cells[1];
  assert.equal(cell.recent, 1, "b, on the test given 7 days ago");
  assert.equal(cell.older, 1, "d, 47 days ago");
  assert.equal(cell.tests, 2);
  assert.deepEqual(cell.standards.map((s) => [s.code, s.percent, s.questions]), [["7.RP.2", 25, 2]], "only standards they answered");
  assert.deepEqual(cell.errorTypes, [{ name: E1, count: 2 }], "their error types only (E2 on c is another student's)");
});

test("another student's answers never move it, and each student gets their own", () => {
  const before = JSON.stringify(G.studentSuperGrid(w, pct, "s1", NOW));
  const changed = structuredClone(w);
  for (const a of changed.assessments) a.responses = a.responses.map((x) => (x.studentId === "s2" ? { ...x, match: 0, errorType: E2 } : x));
  assert.equal(JSON.stringify(G.studentSuperGrid(changed, pct, "s1", NOW)), before);
  const s2 = G.studentSuperGrid(w, pct, "s2", NOW);
  assert.deepEqual(s2.rows.map((row) => row.cluster.key), ["7.RP", "7.G"]);
  assert.equal(s2.rows[0].cells[1].percent, 100);
  assert.equal(s2.noDok, 0, "s2 did not answer the question with no DOK");
});

test("read in the class's grading mode: 0–4 for a Standards-Based class", () => {
  const cell = G.studentSuperGrid(w, { id: "c1", gradingMode: "sbg" }, "s1", NOW).rows[0].cells[1];
  assert.equal(cell.score4, 1, "0 -> 0 and 50 -> 2: average 1.0");
  assert.equal(cell.percent, 25);
  assert.equal(G.studentSuperGrid(w, pct, "s1", NOW).rows[0].cells[1].score4, null);
});

test("a student with nothing confirmed yet gets an empty grid, not an error", () => {
  const grid = G.studentSuperGrid(w, pct, "s9", NOW);
  assert.deepEqual(grid.rows, []);
  assert.equal(grid.tests, 0);
});

test("picking a student shows it above Evidence by standard; its panel is about their answers; no pre-teach and no AI", () => {
  const page = readFileSync("components/teacher-insights.tsx", "utf8");
  const view = page.slice(page.indexOf("export function StudentsView("));
  const at = view.indexOf("<StudentSuperGrid w={w} classroom={classroom} student={student} />");
  assert.ok(at > 0 && at < view.indexOf('title="Evidence by standard"'));
  const grid = readFileSync("components/class-super-grid.tsx", "utf8");
  assert.match(grid, /studentSuperGrid\(w, classroom, student\.id\)/);
  assert.match(grid, /"Questions answered this school year"/);
  assert.match(grid, /preteach=\{scope === "class" \? preteachFocus\(/, "a pre-teach lesson is planned for the class, not from one student");
  for (const f of ["lib/super-grid.ts", "components/class-super-grid.tsx"])
    assert.doesNotMatch(readFileSync(f, "utf8"), /fetch\(|\/api\/analyze|callAi/, f + ": no request at all");
});
