// PR7: a deeper report -- % correct at each DOK and Costa level with question
// counts, and the most common error types -- per student, per class, and in the
// printable/text reports. Michael and Ricky asked to see depth-of-knowledge and
// error patterns alongside the standards percentages.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";
import path from "node:path";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);
function bundle(entry) {
  const r = buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    absWorkingDir: ROOT,
    alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
    external: ["pdfjs-dist/legacy/build/pdf.mjs"],
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(
    m,
    m.exports,
    require,
  );
  return m.exports;
}

const { dokBreakdown, costaBreakdown, cognitiveReportLines } = bundle(
  "lib/teacher-metrics.ts",
);
const { studentErrorTypes, classAnalysisReport, classAnalysis } = bundle(
  "lib/teacher-class-analysis.ts",
);

const q = (id, dok, costas, standard) => ({
  id,
  number: Number(id.slice(1)),
  text: "Q" + id,
  passage: "",
  answer: "a",
  standard,
  secondary: "",
  skill: "",
  dok,
  costas,
  alignment: 90,
  improvement: "",
  confidence: 95,
  level: "On grade",
  reasoning: "",
  verified: true,
  excluded: false,
});
const resp = (studentId, questionId, match, errorType) => ({
  id: studentId + questionId,
  studentId,
  questionId,
  answer: "a",
  correct: match >= 100,
  match,
  misconception: "",
  confidence: 95,
  verified: true,
  errorType,
});

const assessment = {
  id: "a1",
  classId: "c1",
  title: "Unit 3",
  subject: "Math",
  grade: 4,
  framework: "California",
  createdAt: "2026-01-01",
  status: "Ready",
  questions: [
    q("q1", 1, 1, "4.NF.1"),
    q("q2", 2, 2, "4.NF.1"),
    q("q3", 2, 2, "4.NF.2"),
    q("q4", 4, 3, "4.NF.2"),
  ],
  responses: [
    resp("s1", "q1", 100, ""),
    resp("s1", "q2", 50, "Sign error"),
    resp("s1", "q3", 0, "Sign error"),
    resp("s1", "q4", 100, ""),
    resp("s2", "q1", 100, ""),
    resp("s2", "q2", 100, ""),
  ],
  uploadIds: [],
  source: "manual",
  targetStandards: ["4.NF.1", "4.NF.2"],
};
const students = [
  { id: "s1", classId: "c1", name: "Ana", color: "", evidence: [] },
  { id: "s2", classId: "c1", name: "Ben", color: "", evidence: [] },
];
const catalog = [
  { code: "4.NF.1", title: "Equiv fractions", subject: "Math", grade: 4, framework: "California", domain: "", cluster: "", wording: "w" },
  { code: "4.NF.2", title: "Compare fractions", subject: "Math", grade: 4, framework: "California", domain: "", cluster: "", wording: "w" },
];

// ---------------------------------------------------------------
// DOK / Costa breakdowns
// ---------------------------------------------------------------

test("DOK breakdown shows only the levels the test assesses, with counts", () => {
  const rows = dokBreakdown(assessment.questions, assessment.responses);
  // Levels present: 1, 2, 4 (no DOK 3 question -> no DOK 3 row).
  assert.deepEqual(rows.map((r) => r.level), [1, 2, 4]);
  const dok2 = rows.find((r) => r.level === 2);
  assert.equal(dok2.questions, 2, "two DOK-2 questions");
  // DOK-2 graded answers: s1/q2=50, s1/q3=0, s2/q2=100 -> mean 50.
  assert.equal(dok2.assessed, 3);
  assert.equal(dok2.percentCorrect, 50);
});

test("Costa breakdown maps levels and averages correctly", () => {
  const rows = costaBreakdown(assessment.questions, assessment.responses);
  assert.deepEqual(rows.map((r) => r.level), [1, 2, 3]);
  const costa1 = rows.find((r) => r.level === 1);
  // Costa 1 = q1: s1=100, s2=100 -> 100%.
  assert.equal(costa1.percentCorrect, 100);
  assert.equal(costa1.assessed, 2);
});

test("unverified answers are not counted", () => {
  const withPending = {
    ...assessment,
    responses: [resp("s3", "q1", 0, ""), ...assessment.responses].map((r, i) =>
      i === 0 ? { ...r, verified: false } : r,
    ),
  };
  const rows = dokBreakdown(withPending.questions, withPending.responses);
  // The unverified 0 on q1 must not drag DOK 1 below 100.
  assert.equal(rows.find((r) => r.level === 1).percentCorrect, 100);
});

test("a single student's breakdown uses only their answers", () => {
  const s1 = assessment.responses.filter((r) => r.studentId === "s1");
  const rows = dokBreakdown(assessment.questions, s1);
  // s1 DOK 1 = q1 = 100.
  assert.equal(rows.find((r) => r.level === 1).percentCorrect, 100);
  // s1 DOK 2 = q2(50), q3(0) -> 25.
  assert.equal(rows.find((r) => r.level === 2).percentCorrect, 25);
});

// ---------------------------------------------------------------
// Error types per student
// ---------------------------------------------------------------

test("student error types are tallied most common first", () => {
  const rows = studentErrorTypes(assessment, "s1");
  assert.deepEqual(rows, [{ errorType: "Sign error", count: 2 }]);
  assert.deepEqual(studentErrorTypes(assessment, "s2"), []);
});

// ---------------------------------------------------------------
// Reports carry the new sections
// ---------------------------------------------------------------

test("cognitiveReportLines renders level, percent, and counts", () => {
  const line = cognitiveReportLines([
    { level: 2, name: "DOK 2", questions: 2, assessed: 3, percentCorrect: 50 },
  ]);
  assert.match(line, /DOK 2: 50% correct across 2 questions \(3 graded\)/);
});

test("the class report includes cognitive demand and common error types", () => {
  const report = classAnalysisReport(
    assessment,
    classAnalysis(assessment, students, catalog),
  );
  assert.match(report, /COGNITIVE DEMAND/);
  assert.match(report, /By Webb DOK/);
  assert.match(report, /By Costa's level/);
  assert.match(report, /MOST COMMON ERROR TYPES/);
  assert.match(report, /Sign error \(2\)/);
});

test("the student report includes cognitive demand and error types", () => {
  const { studentReport } = bundle("lib/teacher-workflow.ts");
  const report = studentReport(assessment, students[0]);
  assert.match(report, /COGNITIVE DEMAND/);
  assert.match(report, /By Webb DOK/);
  assert.match(report, /MOST COMMON ERROR TYPES/);
  assert.match(report, /Sign error \(2\)/);
});

// ---------------------------------------------------------------
// The views render the breakdown
// ---------------------------------------------------------------

test("the class view renders a depth-of-knowledge breakdown", () => {
  const src = readFileSync("components/teacher-assessments.tsx", "utf8");
  assert.match(src, /function CognitiveBreakdown/);
  assert.match(src, /<CognitiveBreakdown/);
});

test("the student view renders a per-student depth breakdown", () => {
  const src = readFileSync("components/teacher-review.tsx", "utf8");
  assert.match(src, /function StudentDepthBreakdown/);
  assert.match(src, /<StudentDepthBreakdown/);
});

// ---------------------------------------------------------------
// ELA area dropdown sits between Subject and Standards
// ---------------------------------------------------------------

test("the ELA area dropdown sits between Subject and Standards in setup", () => {
  const src = readFileSync("components/teacher-scan.tsx", "utf8");
  const subjectAt = src.indexOf("Assessment subject");
  const elaAt = src.indexOf('label="ELA area"');
  const standardsAt = src.indexOf("Standards framework");
  assert.ok(subjectAt > 0 && elaAt > 0 && standardsAt > 0);
  assert.ok(
    subjectAt < elaAt && elaAt < standardsAt,
    "order must be Subject -> ELA area -> Standards",
  );
});
