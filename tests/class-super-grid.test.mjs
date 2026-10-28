// The class super grid, build step 1 (docs/design/super-grids.md; Ricky,
// 22 Oct 2026). Proven when: rows are standard clusters found from the code
// (7.RP, A-CED, RL, Florida AR) or the catalog's domain, else "Other
// standards"; columns are DOK 1-4; a cell pools every confirmed answer from
// the class's tests given in the teacher's school year -- only students on
// the roster, never an excluded question, an unchecked second choice or an
// unconfirmed answer -- read in the CLASS's grading mode; and its panel has
// the score, questions asked (last 30 days vs before, by date given), the
// weakest standards and the common errors. No AI call: the grid is pure.
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
// Whatever the Math list is on this branch (#190 replaces it): two of its names.
const [E1, E2] = bundle("lib/error-types.ts").errorTypesFor("Math");

test("a cluster is found from the code's shape, per framework", () => {
  const cases = {
    "7.RP.1": "7.RP", "CCSS.MATH.CONTENT.7.RP.A.1": "7.RP", "4.NBT.B.5": "4.NBT", "K.CC.3": "K.CC",
    "A-CED.1": "A-CED", "HSA-CED.A.1": "A-CED", "F-IF.4": "F-IF",
    "RL.7.1": "RL", "CCSS.ELA-LITERACY.RL.7.1": "RL", "RI.4.2": "RI", "W.7.3": "W", "L.7.1": "L",
    "MA.7.AR.1.1": "AR", "ELA.7.R.1.1": "R",
  };
  for (const [code, want] of Object.entries(cases)) assert.equal(G.clusterCode(code), want, code);
  for (const code of ["7.4(A)", "7.1", "custom-1"]) assert.equal(G.clusterCode(code), null, code + " carries no cluster");
});

test("without a code shape the catalog's domain is the cluster; with neither, Other standards", () => {
  const tx = G.clusterOf("7.4(A)", { domain: "Proportionality" });
  assert.deepEqual(tx, { key: "domain:proportionality", code: null, name: "Proportionality" });
  assert.equal(G.clusterOf("7.4(B)", { domain: "PROPORTIONALITY " }).key, tx.key, "case and spaces do not split a row");
  assert.equal(G.tidyDomain("Number & Operations—Fractions"), G.tidyDomain("number and operations fractions"));
  assert.equal(G.clusterLabel(G.clusterOf("custom-1", null)), "Other standards");
  assert.equal(G.clusterLabel(G.clusterOf("7.RP.1", { domain: "Ratios and Proportional Relationships" })), "Ratios and Proportional Relationships · 7.RP");
});

// A made-up class. "Now" is 27 Oct 2026; school year 2026–27.
const NOW = new Date(2026, 9, 27, 12);
const q = (id, standard, dok, extra = {}) => ({ id, number: 1, text: "", passage: "", answer: "", standard, secondary: "", skill: "", dok, alignment: 90, confidence: 90, level: "", reasoning: "", verified: true, excluded: false, ...extra });
const r = (studentId, questionId, match, extra = {}) => ({ id: studentId + questionId, studentId, questionId, answer: "", correct: match === 100, match, misconception: "", confidence: 90, verified: true, ...extra });
const test1 = {
  id: "t1", classId: "c1", title: "Ratios quiz", subject: "Math", grade: 7, framework: "California", createdAt: "2026-09-01T12:00:00Z",
  dateGiven: "2026-10-20", status: "Ready", source: "manual", targetStandards: [], answerKeyVerified: true, uploadIds: [],
  questions: [q("a", "7.RP.1", 1), q("b", "7.RP.2", 2), q("c", "7.RP.1", 2), q("x", "7.RP.1", 2, { excluded: true }), q("nodok", "7.RP.1", null),
    q("second", "7.EE.1", 2, { secondChoice: true, verified: false })],
  responses: [
    r("s1", "a", 100), r("s2", "a", 50),
    r("s1", "b", 0, { errorType: E1 }), r("s2", "b", 50, { errorType: E1 }),
    r("s1", "c", 100), r("s2", "c", 75, { verified: false }), // unconfirmed: not counted
    r("gone", "a", 0), // a student no longer on the roster
    r("s1", "x", 0), r("s1", "second", 0),
  ],
};
const test2 = { ...test1, id: "t2", title: "Older quiz", dateGiven: "2026-09-10",
  questions: [q("d", "7.RP.2", 2), q("e", "7.EE.1", 3)],
  responses: [r("s1", "d", 100, { errorType: E2 }), r("s2", "d", 100, { errorType: "Not on any list" }), r("s1", "e", 25)] };
const lastYear = { ...test1, id: "t3", dateGiven: "2026-05-01", responses: [r("s1", "a", 0), r("s2", "a", 0)] };
const sbgTest = { ...test2, id: "t4", gradingMode: "sbg", dateGiven: "2026-10-26", questions: [q("f", "7.RP.2", 2)], responses: [r("s1", "f", 75), r("s2", "f", 25)] };
const otherClass = { ...test1, id: "t5", classId: "c2" };
const w = {
  students: [{ id: "s1", classId: "c1" }, { id: "s2", classId: "c1" }, { id: "s9", classId: "c2" }],
  assessments: [test1, test2, lastYear, sbgTest, otherClass],
  customStandards: [], sharedStandards: [],
  settings: { teacherName: "", school: "", reduceMotion: false },
};

test("rows by cluster, DOK columns, this school year's tests of this class only", () => {
  const grid = G.classSuperGrid(w, { id: "c1", gradingMode: "percentage" }, NOW);
  assert.equal(grid.schoolYear, 2026);
  assert.equal(grid.tests, 3, "t1, t2 and t4: not last year's, not another class's");
  assert.deepEqual(grid.rows.map((row) => row.cluster.key), ["7.RP", "7.EE"]);
  assert.equal(grid.rows[0].label, "Ratios and Proportional Relationships · 7.RP");
  assert.equal(grid.noDok, 1, "t1's question with no DOK: left out, and counted");
  const rp = grid.rows[0].cells;
  // DOK 1: s1 100, s2 50 -- the student who left and last year's test do not count.
  assert.equal(rp[0].percent, 75);
  assert.equal(rp[0].answers, 2);
  // DOK 2: b (0, 50), c (100; the unconfirmed 75 left out), d (100, 100), f (75, 25) -> 450 / 7.
  assert.equal(rp[1].answers, 7);
  assert.equal(rp[1].percent, Math.round(450 / 7));
  assert.equal(rp[2].questions, 0, "Not Tested");
  // 7.EE: the unchecked second choice is not there; t2's DOK 3 question is.
  assert.equal(grid.rows[1].cells[1].questions, 0);
  assert.equal(grid.rows[1].cells[2].percent, 25);
});

test("the tap panel: questions in the last 30 days and before, weakest standards, common errors", () => {
  const cell = G.classSuperGrid(w, { id: "c1", gradingMode: "percentage" }, NOW).rows[0].cells[1];
  assert.equal(cell.questions, 4, "b and c on t1, d on t2, f on t4");
  assert.equal(cell.recent, 3, "t1 (7 days ago) and t4 (yesterday)");
  assert.equal(cell.older, 1, "t2 (47 days ago)");
  assert.equal(cell.tests, 3);
  assert.deepEqual(cell.standards.map((s) => [s.code, s.percent]), [["7.RP.2", Math.round(350 / 6)], ["7.RP.1", 100]], "weakest first");
  assert.deepEqual(cell.errorTypes, [{ name: E1, count: 2 }, { name: E2, count: 1 }], "most common first; a name on no list is left out");
});

test("a Standards-Based class reads 0–4 with the 0–4 levels; a Percentage class reads percent", () => {
  const sbg = G.classSuperGrid(w, { id: "c1", gradingMode: "sbg" }, NOW).rows[0].cells[0];
  assert.equal(sbg.score4, 3, "100 -> 4 and 50 -> 2: average 3.0");
  assert.equal(sbg.level.level, "Proficient");
  const pct = G.classSuperGrid(w, { id: "c1", gradingMode: "percentage" }, NOW).rows[0].cells[0];
  assert.equal(pct.score4, null);
  assert.equal(pct.level.level, "Approaching", "75%");
});

test("a class with no tests this year shows an empty grid, not an error", () => {
  const grid = G.classSuperGrid(w, { id: "c3" }, NOW);
  assert.deepEqual(grid.rows, []);
  assert.equal(grid.tests, 0);
});

test("it is the first thing on Lesson Planning, and makes no AI call", () => {
  const planning = readFileSync("components/teacher-planning.tsx", "utf8");
  const view = planning.slice(planning.indexOf("export function ReteachView("));
  assert.ok(view.indexOf("<ClassSuperGrid w={w} classroom={classroom} />") > 0);
  assert.ok(view.indexOf("<ClassSuperGrid") < view.indexOf("<Tabs value={tab}"), "above the lesson builder");
  for (const f of ["lib/super-grid.ts", "components/class-super-grid.tsx"]) {
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /fetch\(|\/api\/analyze|callAi/, f + ": no request at all");
  }
});
