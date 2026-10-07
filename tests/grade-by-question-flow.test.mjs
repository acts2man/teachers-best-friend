// Per-question points (Ricky) and grading by question the way Ricky asked:
// group by the answer students reached, a summary per question, credit in
// points given once per group by the teacher -- never by the AI.
import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
function bundle(p) {
  const r = buildSync({
    entryPoints: [p], bundle: true, platform: "node", format: "cjs", write: false,
    alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
  });
  const shim = { exports: {} };
  new Function("module", "exports", r.outputFiles[0].text)(shim, shim.exports);
  return shim.exports;
}
const W = bundle("lib/teacher-workflow.ts");
const S = bundle("lib/analyze-shared.ts");

const q = (id, number, extra = {}) => ({
  id, number, text: "q" + number, passage: "", answer: "11163", standard: "3.NBT.2", secondary: "",
  skill: "", dok: 1, alignment: 100, confidence: 100, level: "On grade", reasoning: "",
  verified: true, excluded: false, ...extra,
});
const r = (id, studentId, questionId, answer, extra = {}) => ({
  id, studentId, questionId, answer, correct: false, misconception: "", confidence: 100, verified: false, ...extra,
});
const assessment = (questions, responses, extra = {}) => ({
  id: "a1", classId: "c1", title: "Quiz", subject: "Math", grade: 3, framework: "California",
  createdAt: "", status: "Ready", source: "manual", targetStandards: ["3.NBT.2"], answerKeyVerified: true,
  uploadIds: [], studentUploadIds: {}, questions, responses, ...extra,
});

// ---- points ----------------------------------------------------------------
test("each question has a worth: its own, else the total split evenly, else 1", () => {
  const a = assessment([q("q1", 1), q("q2", 2), q("q3", 3, { points: 5 })], []);
  assert.equal(W.questionPoints(a, a.questions[2]), 5);
  assert.equal(W.questionPoints(a, a.questions[0]), 1);
  assert.equal(W.totalPoints(a), 7);
  const even = assessment([q("q1", 1), q("q2", 2)], [], { pointsPossible: 10 });
  assert.equal(W.questionPoints(even, even.questions[0]), 5);
  assert.equal(W.totalPoints(even), 10, "an old assessment with only a total keeps its total");
});

test("setting one question's points fixes the others and makes the total the sum", () => {
  const a = assessment([q("q1", 1), q("q2", 2), q("q3", 3)], [], { pointsPossible: 6 });
  const next = W.setQuestionPoints(a, "q2", 4);
  assert.deepEqual(next.questions.map((x) => x.points), [2, 4, 2]);
  assert.equal(next.pointsPossible, 8);
  assert.equal(W.totalPoints(next), 8);
});

test("partial credit is recorded in points: 3 of 4 is 75% of the question", () => {
  const a = assessment([q("q1", 1, { points: 4 })], []);
  assert.equal(W.creditForPoints(a, a.questions[0], 3), 75);
  assert.equal(W.pointsEarned(a, r("r1", "s1", "q1", "x", { match: 75, verified: true })), 3);
});

test("a student's score is weighted by what each question is worth", () => {
  const a = assessment(
    [q("q1", 1, { points: 1 }), q("q2", 2, { points: 4 })],
    [
      r("r1", "s1", "q1", "11163", { correct: true, match: 100, verified: true }),
      r("r2", "s1", "q2", "x", { match: 50, verified: true }),
    ],
  );
  const s = W.studentReview(a, "s1");
  assert.equal(s.pointsEarned, 3);
  assert.equal(s.pointsPossible, 5);
  assert.equal(s.score, 60, "3 of 5, not the 75% an unweighted average gives");
});

test("with every question worth the same, scores are exactly what they were", () => {
  const a = assessment(
    [q("q1", 1), q("q2", 2)],
    [r("r1", "s1", "q1", "a", { match: 100, correct: true, verified: true }), r("r2", "s1", "q2", "b", { match: 50, verified: true })],
  );
  assert.equal(W.studentReview(a, "s1").score, 75);
});

// ---- grouping by the answer reached ----------------------------------------
test("Michael's groups of one: the same final answer written three ways is one group", () => {
  const a = assessment([q("q1", 1)], [
    r("r1", "s1", "q1", "5,753 + 2,250 + 3,160 = 11,163", { finalAnswer: "11163", suggestedErrorType: "" }),
    r("r2", "s2", "q1", "11,163", { finalAnswer: "11163" }),
    r("r3", "s3", "q1", "11,163 people", { finalAnswer: "11163" }),
    r("r4", "s4", "q1", "11,036", { finalAnswer: "11036", suggestedErrorType: "Algebraic/Arithmetic error" }),
  ]);
  const groups = W.groupAnswers(a, "q1");
  assert.equal(groups.length, 2);
  const big = groups.find((g) => g.answer === "11163");
  assert.equal(big.studentIds.length, 3);
  assert.equal(big.written.length, 3, "the teacher still sees how each wrote it");
  assert.equal(groups.find((g) => g.answer === "11036").suggestedErrorType, "Algebraic/Arithmetic error");
});

test("answers graded before final answers existed still group by what was written", () => {
  const a = assessment([q("q1", 1)], [r("r1", "s1", "q1", "42"), r("r2", "s2", "q1", "42 ")]);
  assert.equal(W.groupAnswers(a, "q1").length, 1);
});

test("a sign keeps two answers apart", () => {
  const a = assessment([q("q1", 1)], [
    r("r1", "s1", "q1", "x = -4", { finalAnswer: "-4" }),
    r("r2", "s2", "q1", "x = 4", { finalAnswer: "4" }),
  ]);
  assert.equal(W.groupAnswers(a, "q1").length, 2);
});

test("each question's summary counts correct, blank or no credit, part credit, and to review", () => {
  const a = assessment([q("q1", 1, { points: 2 })], [
    r("r1", "s1", "q1", "11163", { finalAnswer: "11163", correct: true, match: 100 }),
    r("r2", "s2", "q1", "", { match: 0 }),
    r("r3", "s3", "q1", "11036", { finalAnswer: "11036" }),
    r("r4", "s4", "q1", "11036", { finalAnswer: "11036" }),
    r("r5", "s5", "q1", "1116", { finalAnswer: "1116", match: 50, verified: true }),
  ]);
  assert.deepEqual(W.questionSummary(a, "q1"), {
    correct: 1, noCredit: 1, partial: 1, needReview: 2, groupsToReview: 1,
  });
});

test("one decision grades the whole group and tags the error type", () => {
  const a = assessment([q("q1", 1, { points: 4 })], [
    r("r3", "s3", "q1", "11036", { finalAnswer: "11036" }),
    r("r4", "s4", "q1", "11,036", { finalAnswer: "11036" }),
  ]);
  const g = W.groupAnswers(a, "q1")[0];
  const next = W.applyGroupScore(a, g.responseIds, W.creditForPoints(a, a.questions[0], 3), "Sign error");
  for (const x of next.responses) {
    assert.equal(x.match, 75);
    assert.equal(x.verified, true);
    assert.equal(x.errorType, "Sign error");
  }
});

// ---- the grading pass ------------------------------------------------------
const ws = {
  assessments: [assessment([q("q1", 1)], [])],
  students: [{ id: "s1", classId: "c1", name: "Maria Gonzalez" }], classes: [], lessons: [],
};

test("the grading pass asks for the final answer, where it is, and an error-type suggestion -- not credit", () => {
  const task = S.buildPrompt(
    S.analyzeInput.parse({ mode: "class_scan", assessmentId: "a1", uploadIds: ["u1"], pageGroups: [[0]] }),
    ws, [], true,
  ).task;
  assert.match(task, /finalAnswer/);
  assert.match(task, /11163/, "the normalization is shown by example");
  assert.match(task, /keep every negative sign/);
  assert.match(task, /region/);
  assert.match(task, /Sign error/, "the subject's error types are offered");
  assert.match(task, /never changes the verdict/);
  assert.match(task, /Do NOT assign partial credit/);
  assert.ok(!task.includes("Maria"), "no student name");
});

test("a region on another student's page is dropped, an off-list error type is too", () => {
  const out = S.finalizeAnalysis(
    S.analyzeInput.parse({ mode: "class_scan", assessmentId: "a1", uploadIds: ["u1", "u2"], pageGroups: [[0], [1]] }),
    { groups: [
      { group: 0, responses: [{ questionId: "q1", answer: "11,036", verdict: "other", finalAnswer: "11036",
        region: { page: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.1 }, errorType: "Made up" }] },
      { group: 1, responses: [{ questionId: "q1", answer: "11,163", verdict: "match", finalAnswer: "11163",
        region: { page: 1, x: 0.1, y: 0.5, width: 0.3, height: 0.1 }, errorType: "" }] },
    ] },
    ws, [],
  );
  const [g0, g1] = out.groups;
  assert.equal(g0.responses[0].answerRegion, null, "page 1 is the other student's");
  assert.equal(g0.responses[0].suggestedErrorType, undefined, "not on the subject's list");
  assert.equal(g0.responses[0].finalAnswer, "11036");
  assert.deepEqual(g1.responses[0].answerRegion, { uploadId: "u2", x: 0.1, y: 0.5, width: 0.3, height: 0.1 });
});

test("the grouped flow is where a teacher lands after confirming names", () => {
  const scan = readFileSync("components/teacher-class-scan.tsx", "utf8");
  assert.match(scan, /getElementById\("grade-by-question"\)/);
  const ui = readFileSync("components/teacher-review.tsx", "utf8");
  assert.match(ui, /id="grade-by-question"/);
  assert.match(ui, /need review/);
  assert.match(ui, /<CroppedPhoto/, "cropped photos of the answer");
  assert.match(ui, /suggested by the AI, change it if it's wrong/);
  assert.match(ui, /<StudentDepthBreakdown/, "the per-student DOK and Costa breakdown stays");
});
