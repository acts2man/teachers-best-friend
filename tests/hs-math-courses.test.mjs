// High-school Math is taught by course, not by year. Grades 9-12 become
// Algebra 1 / Geometry / Algebra 2 / Pre-Calculus, plus Calculus (13), for
// Math only; ELA and everything else keep grades 9-12. Courses are numeric
// codes (9-13) so they round-trip through the text/safe_int grade column and
// existing grade 9-12 Math assessments keep working.
import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);
function bundle(entry) {
  const r = buildSync({
    entryPoints: [entry], bundle: true, platform: "node", format: "cjs",
    write: false, absWorkingDir: ROOT,
    alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

const gl = bundle("lib/grade-labels.ts");
const { buildPrompt, analyzeInput } = bundle("lib/analyze-shared.ts");

test("the five Math courses map to grade codes 9-13", () => {
  assert.deepEqual(
    gl.MATH_COURSES,
    [
      { grade: 9, name: "Algebra 1" },
      { grade: 10, name: "Geometry" },
      { grade: 11, name: "Algebra 2" },
      { grade: 12, name: "Pre-Calculus" },
      { grade: 13, name: "Calculus" },
    ],
  );
  assert.equal(gl.MAX_GRADE, 13);
});

test("a Math high-school grade reads as its course; other subjects stay grades", () => {
  assert.equal(gl.gradeLabel(9, "Math"), "Algebra 1");
  assert.equal(gl.gradeLabel(12, "Math"), "Pre-Calculus");
  assert.equal(gl.gradeLabel(13, "Math"), "Calculus");
  assert.equal(gl.gradeLabel(4, "Math"), "Grade 4");
  assert.equal(gl.gradeLabel(0, "Math"), "Kindergarten");
  assert.equal(gl.gradeLabel(9, "ELA"), "Grade 9");
  assert.equal(gl.gradeLabel(12, "ELA"), "Grade 12");
  assert.equal(gl.gradeLabel(0), "Kindergarten");
});

test("the picker offers courses for Math and grades otherwise", () => {
  const math = gl.gradeOptions("Math").map((o) => o.label);
  assert.ok(math.includes("Algebra 1") && math.includes("Calculus"));
  assert.ok(!math.includes("Grade 9"), "Math replaces grade 9-12 with courses");
  assert.ok(math.includes("Grade 8") && math.includes("Kindergarten"), "K-8 unchanged");
  const ela = gl.gradeOptions("ELA").map((o) => o.label);
  assert.ok(ela.includes("Grade 9") && ela.includes("Grade 12"));
  assert.ok(!ela.some((l) => l === "Calculus"), "no courses for ELA");
});

test("Calculus (13) is dropped when the subject leaves Math", () => {
  assert.equal(gl.gradeForSubject(13, "Math"), 13);
  assert.equal(gl.gradeForSubject(13, "ELA"), 12);
  assert.equal(gl.gradeForSubject(13, undefined), 12);
  assert.equal(gl.gradeForSubject(9, "ELA"), 9); // 9-12 are valid under any subject
});

test("isMathCourseGrade only fires for Math 9-13", () => {
  assert.equal(gl.isMathCourseGrade("Math", 9), true);
  assert.equal(gl.isMathCourseGrade("Math", 13), true);
  assert.equal(gl.isMathCourseGrade("Math", 4), false);
  assert.equal(gl.isMathCourseGrade("ELA", 9), false);
});

// --- the standards lookup prompt is course-aware ---

const cal = (grade, subject) =>
  buildPrompt(
    analyzeInput.parse({ mode: "catalog", grade, subject, framework: "California" }),
    { assessments: [], students: [], classes: [], lessons: [] },
    [],
    false,
  ).task;

test("the catalog prompt asks for the course, following the traditional pathway", () => {
  const t = cal(9, "Math");
  assert.match(t, /Algebra 1 course/);
  assert.match(t, /traditional high-school pathway/i);
  assert.doesNotMatch(t, /standards for grade 9/i, "not a bare grade number");
});

test("Pre-Calculus pulls in the (+) advanced standards", () => {
  const t = cal(12, "Math");
  assert.match(t, /Pre-Calculus course/);
  assert.match(t, /\(\+\)/, "mentions the (+) advanced standards");
});

test("Calculus is handled honestly — no invented CA codes", () => {
  const t = cal(13, "Math");
  assert.match(t, /Calculus course/);
  assert.match(t, /do not define a full Calculus course/i);
  assert.match(t, /CALC\./, "uses course-topic codes, not CA codes");
});

test("ELA and K-8 Math prompts still read as grades", () => {
  assert.match(cal(9, "ELA"), /standards for grade 9/i);
  assert.match(cal(4, "Math"), /standards for grade 4/i);
});

test("analyzeInput accepts the Calculus grade code (13)", () => {
  const parsed = analyzeInput.safeParse({ mode: "catalog", grade: 13, subject: "Math", framework: "California" });
  assert.equal(parsed.success, true);
  const tooHigh = analyzeInput.safeParse({ mode: "catalog", grade: 14, subject: "Math", framework: "California" });
  assert.equal(tooHigh.success, false, "14 is still rejected");
});

test("the grade pickers are subject-aware in the UI", () => {
  const { readFileSync } = require("node:fs");
  for (const f of [
    "components/teacher-scan.tsx",
    "components/teacher-insights.tsx",
    "components/admin/unlock-standards.tsx",
  ]) {
    assert.match(readFileSync(f, "utf8"), /gradeOptions\(/, `${f} builds options from gradeOptions`);
  }
});
