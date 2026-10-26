// 0–4 scoring on Standards-Based tests (26 Oct 2026): blank = 0, correct = 4,
// the teacher picks 0–4 for each group of wrong answers; each student's result
// and each standard shows the 0–4 average to one decimal with the 0–4 cuts
// (Beginning below 1.95, Approaching 1.95–2.94, Proficient 2.95–3.44,
// Exceeding 3.45 and up); the Standard Tracker reads each test in its own
// mode; the gradebook CSV has 0–4 columns. Made-up students only.
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
const G = bundle("lib/grading-mode.ts");
const W = bundle("lib/teacher-workflow.ts");
const A = bundle("lib/teacher-class-analysis.ts");

const q = (id, number, standard) => ({ id, number, text: "Q" + number, answer: "4", standard, verified: true, dok: 1 });
const resp = (studentId, questionId, match) => ({
  id: studentId + "-" + questionId, studentId, questionId, answer: "x", match, correct: match >= 100,
  misconception: "", confidence: 100, verified: true,
});
function test4(matches, mode = "sbg") {
  // Q1, Q2 on 7.RP.1; Q3, Q4 on 7.RP.2. matches: { studentId: [m1..m4] }.
  const questions = [q("q1", 1, "7.RP.1"), q("q2", 2, "7.RP.1"), q("q3", 3, "7.RP.2"), q("q4", 4, "7.RP.2")];
  return {
    id: "t1", classId: "c1", title: "Unit test", subject: "Math", grade: "7", framework: "CCSS",
    gradingMode: mode, questions, answerKeyVerified: true,
    responses: Object.entries(matches).flatMap(([s, ms]) => ms.map((m, i) => (m === null ? [] : [resp(s, "q" + (i + 1), m)])).flat()),
  };
}

test("blank is 0, correct is 4, and every score in between is a quarter", () => {
  assert.deepEqual(G.SBG_SCORES, [0, 1, 2, 3, 4]);
  assert.deepEqual([0, 1, 2, 3, 4].map(G.matchOfScore4), [0, 25, 50, 75, 100]);
  assert.deepEqual(G.score4OfMatch(100), { score: 4, converted: false });
  assert.deepEqual(G.score4OfMatch(0), { score: 0, converted: false });
  // A credit given in Percentage that is not a quarter: shown as the nearest
  // whole score, marked converted, nothing rewritten.
  assert.deepEqual(G.score4OfMatch(67), { score: 3, converted: true });
});

test("the 0–4 cut-offs, on the score shown to one decimal", () => {
  const level = (s) => W.studentReview(test4({ s: [s * 25, s * 25, s * 25, s * 25] }), "s").score4;
  assert.equal(G.score4Text(1.94), "1.9");
  assert.equal(G.score4Text(1.95), "2.0");
  assert.equal(G.score4Text(3), "3.0");
  assert.equal(G.score4Result(1.94).level.level, "Beginning");
  assert.equal(G.score4Result(1.95).level.level, "Approaching");
  assert.equal(G.score4Result(2.94).level.level, "Approaching");
  assert.equal(G.score4Result(2.95).level.level, "Proficient");
  assert.equal(G.score4Result(3.44).level.level, "Proficient");
  assert.equal(G.score4Result(3.45).level.level, "Exceeding");
  assert.equal(level(2), 2);
});

test("a student's result is the plain average of the 0–4 scores; each standard has its own", () => {
  const a = test4({ s: [100, 0, 75, 50] });
  const r = W.studentReview(a, "s");
  assert.equal(r.score4, 2.25); // (4 + 0 + 3 + 2) / 4
  assert.equal(G.score4Text(r.score4), "2.3");
  assert.equal(W.standardAverage4(a, r.counted, "7.RP.1"), 2);
  assert.equal(W.standardAverage4(a, r.counted, "7.RP.2"), 2.5);
  // Points are not read: every question counts 4.
  a.questions[0].points = 10;
  assert.equal(W.studentReview(a, "s").score4, 2.25);
  // Percentage tests have no 0–4 result.
  assert.equal(W.studentReview(test4({ s: [100, 0, 75, 50] }, "percentage"), "s").score4, null);
});

test("class analysis groups by the 0–4 levels on a Standards-Based test", () => {
  const students = [{ id: "s1", name: "Student A" }, { id: "s2", name: "Student B" }];
  const catalog = [{ code: "7.RP.1", title: "Ratios" }, { code: "7.RP.2", title: "Proportions" }];
  // 7.RP.1: Student A averages 2.0 (50%) -- Approaching on 0–4, Beginning as a percent.
  const sbg = A.classAnalysis(test4({ s1: [50, 50, 100, 100], s2: [100, 75, 100, 100] }), students, catalog);
  const rp1 = sbg.find((r) => r.standard.code === "7.RP.1");
  assert.deepEqual(rp1.byLevel.Approaching.map((s) => s.id), ["s1"]);
  assert.deepEqual(rp1.byLevel.Exceeding.map((s) => s.id), ["s2"]); // 3.5
  assert.equal(rp1.average4, 2.75);
  const pct = A.classAnalysis(test4({ s1: [50, 50, 100, 100], s2: [100, 75, 100, 100] }, "percentage"), students, catalog);
  assert.deepEqual(pct.find((r) => r.standard.code === "7.RP.1").byLevel.Beginning.map((s) => s.id), ["s1"]);
  assert.equal(pct[0].average4, null);
  assert.match(A.classAnalysisReport(test4({ s1: [50, 50, 100, 100], s2: [100, 75, 100, 100] }), sbg), /Class average 2\.8 out of 4 \(Approaching\)/);
});

test("the gradebook CSV: 0–4 per question, the average to one decimal and the level", () => {
  const a = test4({ s1: [100, 0, 75, 50] });
  const csv = W.gradebookCsv(a, [{ id: "s1", name: "Student A" }]).split("\n");
  const unq = (line) => line.split(",").map((f) => f.replace(/^"|"$/g, ""));
  assert.deepEqual(unq(csv[0]), ["Student", "Q1 (0–4)", "Q2 (0–4)", "Q3 (0–4)", "Q4 (0–4)", "Average (0–4)", "Level", "Reviewed", "Needs grading"]);
  assert.deepEqual(unq(csv[1]), ["Student A", "4", "0", "3", "2", "2.3", "Approaching", "4/4", ""]);
  // Percentage tests keep the points gradebook.
  const pct = W.gradebookCsv(test4({ s1: [100, 0, 75, 50] }, "percentage"), [{ id: "s1", name: "Student A" }]);
  assert.deepEqual(unq(pct.split("\n")[0]).slice(0, 2), ["Student", "Q1 (1 pts)"]);
});

test("the Standard Tracker reads each test in its own mode, from the test's answers", () => {
  // 7.RP.1 averages 3.45 (100, 72.5 -> 4, 2.9): "3.5", Exceeding. The stored
  // whole percent (86) would read 3.44 -> "3.4", Proficient.
  const a = test4({ s: [100, 72.5, 100, 100] });
  const e = { score: 86, standard: "7.RP.1", assessmentId: "t1" };
  const shown = W.evidenceShown({ assessments: [a] }, "s", e);
  assert.equal(shown.sbg, true);
  assert.equal(shown.text, "3.5 / 4");
  // A percentage test, or a test that is gone, reads as before / falls back.
  assert.deepEqual(W.evidenceShown({ assessments: [{ ...a, gradingMode: undefined }] }, "s", e), { sbg: false, percent: 86 });
  assert.deepEqual(W.evidenceShown({ assessments: [] }, "s", e), { sbg: false, percent: 86 });
  const src = readFileSync("components/teacher-insights.tsx", "utf8");
  assert.match(src, /const shown = evidenceShown\(w, student\.id, e\);/);
});

test("the screens: 0–4 buttons to grade, 0–4 results shown, no 'coming next' note", () => {
  const review = readFileSync("components/teacher-review.tsx", "utf8");
  assert.match(review, /\{SBG_SCORES\.map\(\(n\) => \(\s*<button/, "five score buttons for a group of answers");
  assert.match(review, /sbg=\{isSbg\(a\)\}/);
  assert.match(review, /score4Text\(summary\.score4\)/);
  assert.match(review, /score4Text\(avg4\) \+ " average \(0–4\) · " \+ masteryLevel4\(avg4\)\.level/);
  const page = readFileSync("components/teacher-assessments.tsx", "utf8");
  assert.doesNotMatch(page, /coming next/);
  assert.match(page, /Class average \{score4Text\(row\.average4\)\} out of 4/);
});
