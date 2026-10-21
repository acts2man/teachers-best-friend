// The grading mode itself (docs/design/grading-modes-and-dok-grid.md, G1).
// A test is graded as a Percentage (today; what no mode means) or
// Standards-Based (0–4). Decided: chosen at setup and switchable any time; a
// new test starts in the mode the teacher used last; switching changes no
// stored grade. Saving the mode is proven by the persistence guard and the
// round-trip invariant (migration 20261020120000) and, on the database, by
// supabase/checks/grading-mode-round-trip.sql. Made-up data only (rule R8).
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
const { gradingModeOf, lastGradingMode, setGradingMode, switchGradingMode, GRADING_MODES } = bundle("lib/grading-mode.ts");

const graded = {
  id: "a1", classId: "c1", title: "Quiz", subject: "Math", grade: 4, framework: "Common Core", createdAt: "2026-10-01T00:00:00Z",
  status: "Ready", source: "manual", targetStandards: ["S.1"], answerKeyVerified: true, uploadIds: [], pointsPossible: 10,
  questions: [
    { id: "q1", number: 1, standard: "S.1", dok: 1, points: 4, verified: true, excluded: false },
    { id: "q2", number: 2, standard: "S.1", dok: 2, points: 6, verified: true, excluded: false },
  ],
  responses: [
    { id: "r1", studentId: "s1", questionId: "q1", answer: "8", correct: true, match: 100, verified: true },
    { id: "r2", studentId: "s1", questionId: "q2", answer: "3", correct: false, match: 67, verified: true, errorType: "Sign error" },
  ],
};
const w = {
  classes: [], students: [{ id: "s1", evidence: [{ id: "e1", standard: "S.1", score: 84, date: "2026-10-01", source: "Quiz", assessmentId: "a1" }] }],
  assessments: [graded, { ...graded, id: "a2" }], lessons: [], resources: [], customStandards: [], sharedStandards: [], groups: [],
  settings: { teacherName: "", school: "", reduceMotion: false },
};

test("two modes; no mode is Percentage", () => {
  assert.deepEqual(GRADING_MODES.map((m) => m.mode), ["percentage", "sbg"]);
  assert.equal(gradingModeOf({}), "percentage");
  assert.equal(gradingModeOf({ gradingMode: "sbg" }), "sbg");
  assert.equal(gradingModeOf({ gradingMode: "abc" }), "percentage");
});

test("switching changes no stored grade, and switching back is the same test", () => {
  const sbg = setGradingMode(graded, "sbg");
  assert.equal(sbg.gradingMode, "sbg");
  assert.deepEqual({ ...sbg, gradingMode: undefined }, { ...graded, gradingMode: undefined }, "nothing but the mode changed");
  assert.deepEqual(sbg.responses, graded.responses);
  assert.deepEqual(sbg.questions, graded.questions, "question points untouched");
  const back = setGradingMode(sbg, "percentage");
  assert.deepEqual(back, graded, "Percentage is stored as no mode: exactly the test it was");
  assert.equal("gradingMode" in back, false);
});

test("a new test starts in the mode the teacher used last", () => {
  assert.equal(lastGradingMode(w), "percentage", "nothing used yet");
  const switched = switchGradingMode(w, "a2", "sbg");
  assert.equal(lastGradingMode(switched), "sbg");
  assert.equal(gradingModeOf(switched.assessments[1]), "sbg");
  assert.equal(gradingModeOf(switched.assessments[0]), "percentage", "only that test switched");
  assert.deepEqual(switched.students, w.students, "evidence untouched");
  assert.equal(lastGradingMode(switchGradingMode(switched, "a2", "percentage")), "percentage");
});

test("setup offers the choice, starts in the last mode and remembers it", () => {
  const src = readFileSync("components/teacher-scan.tsx", "utf8");
  assert.match(src, /useState<GradingMode>\(\(\) => lastGradingMode\(w\)\)/);
  assert.match(src, /<GradingModeChoice value=\{gradingMode\} onChange=\{setGradingMode\} \/>/);
  assert.equal((src.match(/settings: \{ \.\.\.w\.settings, lastGradingMode: gradingMode \}/g) || []).length, 3, "every save that creates a test");
  assert.match(src, /gradingMode === "sbg" \? \{ gradingMode: "sbg" as const \} : \{\}/);
});

test("the test page has the switch, and it only switches the mode", () => {
  const src = readFileSync("components/teacher-assessments.tsx", "utf8");
  assert.match(src, /<GradingModeChoice\s+value=\{gradingModeOf\(a\)\}[\s\S]{0,300}switchGradingMode\(w, a\.id, mode\)/);
});

test("the save schema keeps the teacher's last mode", () => {
  const src = readFileSync("app/api/workspace/route.ts", "utf8");
  assert.match(src, /lastGradingMode: z\.enum\(\["percentage", "sbg"\]\)\.optional\(\)/);
});
