// Ricky's spec (15 Oct 2026): four mastery levels replace the single
// "mastered at 70%" idea everywhere.
//
//   Developing 0–69% (red; reteach and support)   Approaching 70–79% (yellow)
//   Proficient 80–89% (blue)                      Exceeding 90–100% (green; extension)
//
// Before this, class analysis split students at 70 ("Mastery is 70% or
// higher"), the student pages said "Mastered" at 80 and "Developing" from 65,
// the colours cut at 80 and 65, and reteach groups cut at 70 -- four rules for
// one idea. Now lib/mastery-levels.ts is the only definition, and the
// boundaries are on the true value: 69.9 is Developing, 70 is Approaching, 90
// is Exceeding. Made-up students only (rule R8).
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
const levels = bundle("lib/mastery-levels.ts");
const { mastery, masteryStatus, priorities, classMastery } = bundle("lib/teacher-data.ts");
const { performanceBands, sharedGapGroups, studentOverall, dokBreakdown } = bundle("lib/teacher-metrics.ts");
const { classAnalysis, writingClassAnalysis, classAnalysisReport } = bundle("lib/teacher-class-analysis.ts");

const student = (id, scores, code = "S.1") => ({
  id, classId: "c1", name: "Student " + id, color: "#000", notes: "",
  evidence: scores.map((score, i) => ({ id: id + i, standard: code, score, date: "2026-10-0" + (i + 1), source: "check" })),
});
const std = (code) => ({ code, title: code, subject: "Math", grade: 4, domain: "", cluster: "", summary: "", skills: [], prerequisites: [], next: [], vocabulary: [], misconception: "", example: "", dok: 2, source: "", framework: "Common Core" });

test("the four levels, with their colours and recommendations", () => {
  assert.deepEqual(
    levels.MASTERY_LEVELS.map((l) => [l.level, l.range, l.tone, l.recommendation]),
    [
      ["Developing", "0–69%", "red", "reteach"],
      ["Approaching", "70–79%", "yellow", null],
      ["Proficient", "80–89%", "blue", null],
      ["Exceeding", "90–100%", "green", "extend"],
    ],
  );
});

test("the boundaries are on the true value: 69.9 Developing, 70 Approaching, 90 Exceeding", () => {
  const at = (p) => levels.masteryLevel(p).level;
  assert.equal(at(0), "Developing");
  assert.equal(at(69.9), "Developing");
  assert.equal(at(69.999), "Developing");
  assert.equal(at(70), "Approaching");
  assert.equal(at(79.9), "Approaching");
  assert.equal(at(80), "Proficient");
  assert.equal(at(89.9), "Proficient");
  assert.equal(at(90), "Exceeding");
  assert.equal(at(100), "Exceeding");
  assert.equal(levels.masteryLevelOf(null), null);
  assert.equal(levels.needsReteach(69.9), true);
  assert.equal(levels.needsReteach(70), false);
  assert.equal(levels.readyToExtend(89.9), false);
  assert.equal(levels.readyToExtend(90), true);
});

test("a shown percentage never crosses into the next level", () => {
  assert.equal(levels.masteryPercent(69.9), 69);
  assert.equal(levels.masteryPercent(240 / 3), 80, "floating point: three 80s average 80");
  assert.equal(levels.masteryPercent(89.99), 89);
  // A student's standard score: three records averaging 69.9 show 69, not 70.
  assert.equal(mastery(student("a", [70, 70, 69.7]), "S.1"), 69);
});

test("a student's standard reads the level, never 'Mastered'", () => {
  assert.equal(masteryStatus(student("a", [70, 70, 69.7]), "S.1"), "Developing");
  assert.equal(masteryStatus(student("b", [70, 70, 70]), "S.1"), "Approaching");
  assert.equal(masteryStatus(student("c", [80, 85, 89]), "S.1"), "Proficient");
  assert.equal(masteryStatus(student("d", [90, 90, 89.7]), "S.1"), "Proficient", "89.9 is not Exceeding");
  assert.equal(masteryStatus(student("e", [90, 95, 100]), "S.1"), "Exceeding");
  // Fewer than three records still says so, as before.
  assert.equal(masteryStatus(student("f", [95]), "S.1"), "Building evidence");
  assert.equal(masteryStatus(student("g", []), "S.1"), "No evidence");
});

test("reteach groups and priorities take Developing students only (69.9 in, 70 out)", () => {
  const roster = [student("a", [70, 70, 69.7]), student("b", [70, 70, 70]), student("c", [95, 95, 95])];
  const [gap] = sharedGapGroups(roster, [std("S.1")]);
  assert.deepEqual(gap.students.map((s) => s.id), ["a"]);
  const [p] = priorities(roster, [std("S.1")]);
  assert.deepEqual(p.students.map((s) => s.id), ["a"]);
});

test("the performance bands are the four levels", () => {
  const roster = [student("a", [60, 60, 60]), student("b", [75, 75, 75]), student("c", [85, 85, 85]), student("d", [95, 95, 95]), student("e", [])];
  const bands = performanceBands(roster, [std("S.1")]);
  assert.deepEqual(bands.map((b) => [b.name, b.range, b.students.map((s) => s.id).join()]), [
    ["Developing", "0–69%", "a"],
    ["Approaching", "70–79%", "b"],
    ["Proficient", "80–89%", "c"],
    ["Exceeding", "90–100%", "d"],
    ["No evidence yet", "Not scored", "e"],
  ]);
});

test("class analysis groups students by level, on the true average", () => {
  const roster = ["a", "b", "c", "d"].map((id) => student(id, []));
  const q = (id) => ({ id, number: 1, text: "", passage: "", answer: "", standard: "S.1", secondary: "", skill: "", dok: 1, alignment: 90, confidence: 90, level: "", reasoning: "", verified: true, excluded: false });
  const r = (studentId, questionId, match) => ({ id: studentId + questionId, studentId, questionId, answer: "", correct: match === 100, match, misconception: "", confidence: 90, verified: true });
  const a = {
    id: "a1", classId: "c1", title: "Quiz", subject: "Math", grade: 4, framework: "Common Core", createdAt: "", status: "Ready", source: "manual", targetStandards: [], answerKeyVerified: true,
    questions: [q("q1"), q("q2")],
    responses: [r("a", "q1", 70), r("a", "q2", 69.8), r("b", "q1", 70), r("b", "q2", 70), r("c", "q1", 80), r("c", "q2", 85), r("d", "q1", 90), r("d", "q2", 90)],
  };
  const [row] = classAnalysis(a, roster, [std("S.1")]);
  const ids = (list) => list.map((s) => s.id);
  assert.deepEqual(ids(row.byLevel.Developing), ["a"], "69.9 is Developing (it was 'mastered' at a rounded 70)");
  assert.deepEqual(ids(row.byLevel.Approaching), ["b"]);
  assert.deepEqual(ids(row.byLevel.Proficient), ["c"]);
  assert.deepEqual(ids(row.byLevel.Exceeding), ["d"]);
  assert.deepEqual(ids(row.reteach), ["a"], "reteach: Developing only");
  assert.deepEqual(ids(row.extend), ["d"], "extension: Exceeding only");
  assert.equal(row.averagePercent, 78, "the class average (78.1) is shown rounded down");
  assert.equal("percentMastered" in row, false);
});

// From the review of this PR.
test("averages across standards or students are built from true values, not rounded twice", () => {
  // 69.67 and 70.33: each shows 69 / 70, but together they average exactly 70.
  const two = { ...student("x", []), evidence: [
    ...[70, 70, 69].map((score, i) => ({ id: "a" + i, standard: "S.1", score, date: "2026-10-0" + (i + 1), source: "c" })),
    ...[70, 71, 70].map((score, i) => ({ id: "b" + i, standard: "S.2", score, date: "2026-10-0" + (i + 1), source: "c" })),
  ] };
  assert.equal(studentOverall(two, [std("S.1"), std("S.2")]), 70, "Approaching, not 69 Developing");
  assert.equal(classMastery([student("a", [70, 70, 69]), student("b", [70, 71, 70])], "S.1"), 70);
  assert.equal(levels.masteryLevel(240 / 3 - 1e-12).level, "Proficient", "level and shown number agree at the boundary");
});

test("a standard no student has evidence on has no class average (not a red 0%)", () => {
  assert.equal(classMastery([student("a", [])], "S.1"), null);
});

test("cognitive-level percentages are rounded down like every level-coloured number", () => {
  const q = (id, dok) => ({ id, number: 1, standard: "S.1", dok, verified: true, excluded: false });
  const r = (id, qid, match) => ({ id, studentId: "s", questionId: qid, correct: match === 100, match, verified: true });
  const rows = dokBreakdown([q("q1", 1), q("q2", 1), q("q3", 1)], [r("1", "q1", 100), r("2", "q2", 100), r("3", "q3", 9)]);
  assert.equal(rows[0].percentCorrect, 69, "69.67 shows 69 (red), not 70 (yellow)");
});

test("extension across standards: Exceeding on every standard assessed, unassessed ones do not block it", () => {
  assert.equal(levels.exceedingOnAllAssessed(["Exceeding", "No evidence", "Building evidence"]), true);
  assert.equal(levels.exceedingOnAllAssessed(["Exceeding", "Proficient"]), false);
  assert.equal(levels.exceedingOnAllAssessed(["No evidence"]), false);
});

test("the class report lists each level and names the reteach and extension groups", () => {
  const roster = ["a", "d"].map((id) => student(id, []));
  const q = { id: "q1", number: 1, text: "", passage: "", answer: "", standard: "S.1", secondary: "", skill: "", dok: 1, alignment: 90, confidence: 90, level: "", reasoning: "", verified: true, excluded: false };
  const r = (studentId, match) => ({ id: studentId, studentId, questionId: "q1", answer: "", correct: match === 100, match, misconception: "", confidence: 90, verified: true });
  const a = { id: "a1", classId: "c1", title: "Quiz", subject: "Math", grade: 4, framework: "Common Core", createdAt: "", status: "Ready", source: "manual", targetStandards: [], answerKeyVerified: true, questions: [q], responses: [r("a", 60), r("d", 95)] };
  // One of two students Developing is half the class: whole-class reteach.
  const text = classAnalysisReport(a, classAnalysis(a, roster, [std("S.1")]));
  assert.match(text, /Developing 0–69% \(1\): Student a/);
  assert.match(text, /Exceeding 90–100% \(1\): Student d/);
  assert.match(text, /Suggested next step: reteach the Developing students \(whole class\); extension for the Exceeding students/);
  assert.match(text, /Developing 0–69% \(reteach and support\), Approaching 70–79%, Proficient 80–89%, Exceeding 90–100% \(extension\)/);
  assert.doesNotMatch(text, /mastery/i);
});

test("writing traits use the same levels", () => {
  const roster = ["a", "b"].map((id) => student(id, []));
  const a = {
    id: "w1", classId: "c1", title: "Essay", subject: "ELA", grade: 4, framework: "Common Core", createdAt: "", status: "Ready", source: "manual", targetStandards: [], answerKeyVerified: true,
    kind: "writing", rubric: [{ id: "t1", name: "Organization", max: 4, descriptor: "", standard: "" }],
    questions: [], responses: [
      { id: "1", studentId: "a", questionId: "t1", answer: "", correct: false, match: 50, rubricScore: 2, misconception: "", confidence: 90, verified: true },
      { id: "2", studentId: "b", questionId: "t1", answer: "", correct: true, match: 100, rubricScore: 4, misconception: "", confidence: 90, verified: true },
    ],
  };
  const rows = writingClassAnalysis(a, roster);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].byLevel.Developing.map((s) => s.id), ["a"]);
  assert.deepEqual(rows[0].byLevel.Exceeding.map((s) => s.id), ["b"]);
});

test("no other mastery cut-off or 'Mastered' wording is left in the app", () => {
  const files = ["lib/teacher-class-analysis.ts", "lib/teacher-data.ts", "lib/teacher-metrics.ts", "lib/teacher-workflow.ts", "components/teacher-insights.tsx", "components/teacher-assessments.tsx", "components/teacher-review.tsx", "components/teacher-guide.tsx", "components/teacher-shared.tsx"];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /MASTERY_THRESHOLD/, f);
    assert.doesNotMatch(src, /Mastery is 70%/, f);
    assert.doesNotMatch(src, /["“]Mastered["”]/, f + ": the 'Mastered' label");
    assert.doesNotMatch(src, /percentMastered/, f);
    // Mastery colours and splits come from lib/mastery-levels.ts.
    assert.doesNotMatch(src, /(?:mastery\([^)]*\)|\.mastery|percentCorrect|averagePercent|percentMastered|\bm|score)\s*(?:\?\?\s*\d+\)?\s*)?[<>]=?\s*(?:65|70|80|90)\b/, f + ": a hand-written mastery cut-off");
  }
});
