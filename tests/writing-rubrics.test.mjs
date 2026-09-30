// ELA Writing: rubric-based scoring. The AI suggests a level and a one-line
// reason per rubric trait; the teacher confirms or changes each before it
// counts. Default rubrics come from California's Smarter Balanced full-writes by
// grade band (K-2 is our own simple version). Scores flow into the writing class
// view and, by each trait's standard, into mastery.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);
function bundle(entry) {
  const r = buildSync({
    entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false,
    absWorkingDir: ROOT,
    alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}
const { defaultRubric, gradeBand, isSimplifiedBand, genreLabel } =
  bundle("lib/writing-rubrics.ts");
const {
  normalizeWritingScores, setWritingScore, confirmWritingScores,
  replaceWritingResponses, writingScored, writingConfirmed,
  preparationGaps,
} = bundle("lib/teacher-workflow.ts");
const { writingClassAnalysis } = bundle("lib/teacher-class-analysis.ts");
const { reconcileEvidence } = bundle("lib/teacher-data.ts");

function writingAssessment(grade = 4, genre = "informational") {
  return {
    id: "a", classId: "c", title: "Lab report", subject: "ELA", elaArea: "writing",
    genre, grade, framework: "California", createdAt: "", status: "Ready",
    source: "manual", targetStandards: [], uploadIds: [], questions: [],
    rubric: defaultRubric(genre, grade), responses: [],
  };
}

// --- default rubrics ---
test("grade bands map the way SBAC publishes them; K-2 is our simple version", () => {
  assert.equal(gradeBand(0), "K-2");
  assert.equal(gradeBand(2), "K-2");
  assert.equal(gradeBand(4), "3-5");
  assert.equal(gradeBand(7), "6-8");
  assert.equal(gradeBand(11), "9-12");
  assert.equal(isSimplifiedBand(1), true);
  assert.equal(isSimplifiedBand(4), false);
});

test("the default rubric has the three SBAC traits with the right maxes and genre wording", () => {
  const info = defaultRubric("informational", 4);
  assert.deepEqual(info.map((d) => d.max), [4, 4, 2]);
  assert.equal(info[0].name, "Purpose / Organization");
  assert.equal(info[1].name, "Evidence / Elaboration");
  assert.equal(info[2].name, "Conventions");
  const narr = defaultRubric("narrative", 4);
  assert.equal(narr[1].name, "Development / Elaboration");
  // Each trait carries a standard for mastery.
  assert.ok(info.every((d) => d.standard));
  // Fresh ids each call, so two assessments never share dimension ids.
  assert.notEqual(defaultRubric("informational", 4)[0].id, info[0].id);
  assert.equal(genreLabel("narrative"), "Narrative");
});

// --- scoring ---
test("normalizeWritingScores maps AI levels to responses, clamps to max, leaves skipped traits unscored", () => {
  const a = writingAssessment(4, "informational");
  const [p, e, conv] = a.rubric;
  const rows = normalizeWritingScores(a, "s1", [
    { dimensionId: p.id, score: 3, reason: "clear intro" },
    { dimensionId: e.id, score: 9, reason: "over max" }, // clamps to 4
    // conventions omitted -> unscored
  ]);
  assert.equal(rows.length, 3);
  const byDim = Object.fromEntries(rows.map((r) => [r.questionId, r]));
  assert.equal(byDim[p.id].rubricScore, 3);
  assert.equal(byDim[p.id].match, 75); // 3/4
  assert.equal(byDim[p.id].rubricReason, "clear intro");
  assert.equal(byDim[e.id].rubricScore, 4, "clamped to the dimension max");
  assert.equal(byDim[e.id].correct, true, "full marks reads correct");
  assert.equal(byDim[conv.id].rubricScore, undefined, "skipped trait is unscored");
  assert.equal(byDim[conv.id].match, undefined);
  assert.ok(rows.every((r) => !r.verified), "nothing is confirmed by the AI");
});

test("setWritingScore sets a level, its percentage, and confirms just that trait", () => {
  let a = writingAssessment(4, "informational");
  a = replaceWritingResponses(a, "s1", normalizeWritingScores(a, "s1", []));
  const conv = a.rubric[2]; // max 2
  a = setWritingScore(a, "s1", conv.id, 1);
  const r = a.responses.find((x) => x.questionId === conv.id);
  assert.equal(r.rubricScore, 1);
  assert.equal(r.match, 50); // 1/2
  assert.equal(r.verified, true);
  // clamps above max
  a = setWritingScore(a, "s1", conv.id, 5);
  assert.equal(a.responses.find((x) => x.questionId === conv.id).rubricScore, 2);
});

test("writingScored/writingConfirmed track the student's progress; confirm-all skips unscored", () => {
  let a = writingAssessment(4, "informational");
  a = replaceWritingResponses(
    a, "s1",
    normalizeWritingScores(a, "s1", [
      { dimensionId: a.rubric[0].id, score: 3, reason: "x" },
      { dimensionId: a.rubric[1].id, score: 2, reason: "y" },
      // conventions unscored
    ]),
  );
  assert.equal(writingScored(a, "s1"), false, "one trait still unscored");
  assert.equal(writingConfirmed(a, "s1"), false);
  a = confirmWritingScores(a, "s1");
  // The two scored traits are confirmed; the unscored one is not.
  assert.equal(a.responses.filter((r) => r.verified).length, 2);
  assert.equal(writingConfirmed(a, "s1"), false, "still not fully confirmed");
  // Give the last trait a score and confirm.
  a = setWritingScore(a, "s1", a.rubric[2].id, 2);
  assert.equal(writingScored(a, "s1"), true);
  assert.equal(writingConfirmed(a, "s1"), true);
});

// --- readiness ---
test("a writing assessment is ready to grade the moment it has a rubric", () => {
  const a = writingAssessment(4);
  assert.equal(preparationGaps(a).ready, true);
  const empty = { ...a, rubric: [] };
  assert.equal(preparationGaps(empty).ready, false);
});

// --- class view ---
test("writingClassAnalysis breaks the class down per trait, most needs-work surfaced", () => {
  const students = [
    { id: "s1", name: "Ana", classId: "c", color: "#000", evidence: [], notes: "" },
    { id: "s2", name: "Ben", classId: "c", color: "#000", evidence: [], notes: "" },
  ];
  let a = writingAssessment(4, "informational");
  const p = a.rubric[0]; // max 4
  // Ana strong (4 -> 100%), Ben weak (1 -> 25%) on Purpose; both confirmed.
  a = replaceWritingResponses(a, "s1", normalizeWritingScores(a, "s1", [{ dimensionId: p.id, score: 4, reason: "x" }]));
  a = replaceWritingResponses(a, "s2", normalizeWritingScores(a, "s2", [{ dimensionId: p.id, score: 1, reason: "y" }]));
  a = confirmWritingScores(a, "s1");
  a = confirmWritingScores(a, "s2");
  const rows = writingClassAnalysis(a, students);
  const purpose = rows.find((r) => r.dimension.id === p.id);
  assert.equal(purpose.averageLabel, "2.5 / 4");
  assert.deepEqual(purpose.strong.map((s) => s.name), ["Ana"]);
  assert.deepEqual(purpose.weak.map((s) => s.name), ["Ben"]);
  // Conventions was never scored -> both students not scored.
  const conv = rows.find((r) => r.dimension.name === "Conventions");
  assert.equal(conv.notScored.length, 2);
  assert.equal(conv.averageLabel, "—");
});

// --- mastery ---
test("confirmed writing scores become mastery evidence, by each trait's standard", () => {
  const students = [{ id: "s1", name: "Ana", classId: "c", color: "#000", evidence: [], notes: "" }];
  let a = writingAssessment(4, "informational");
  a = replaceWritingResponses(a, "s1", normalizeWritingScores(a, "s1", [
    { dimensionId: a.rubric[0].id, score: 4, reason: "x" }, // W.4.4 -> 100
    { dimensionId: a.rubric[1].id, score: 2, reason: "y" }, // W.4.2 -> 50
    { dimensionId: a.rubric[2].id, score: 1, reason: "z" }, // L.4.2 -> 50
  ]));
  a = confirmWritingScores(a, "s1");
  const [student] = reconcileEvidence(students, a);
  const byCode = Object.fromEntries(student.evidence.map((e) => [e.standard, e.score]));
  assert.equal(byCode["W.4.4"], 100);
  assert.equal(byCode["W.4.2"], 50);
  assert.equal(byCode["L.4.2"], 50);
  // Unconfirmed scores do not count.
  const a2 = { ...a, responses: a.responses.map((r) => ({ ...r, verified: false })) };
  assert.equal(reconcileEvidence(students, a2)[0].evidence.length, 0);
});

// --- component wiring ---
test("the assessment page branches to the writing tabs and components", () => {
  const ui = readFileSync("components/teacher-assessments.tsx", "utf8");
  assert.match(ui, /isWritingAssessment\(a\) \? \(/, "tabs branch for writing");
  assert.match(ui, /<WritingRubricPanel/, "rubric view/edit");
  assert.match(ui, /<WritingReview/, "per-student rubric confirm");
  assert.match(ui, /<WritingClassPanel/, "writing class view");
  assert.match(ui, /splitNameBand\(incoming\[i\]\)/, "the name band is cut from page 1");
  assert.match(ui, /mode: "writing"/, "scores via the writing mode");
});

test("setup offers a genre for writing and creates without a document read", () => {
  const ui = readFileSync("components/teacher-scan.tsx", "utf8");
  assert.match(ui, /const isWriting = subject === "ELA" && elaArea === "writing"/);
  assert.match(ui, /WRITING_GENRES\.map/, "genre picker");
  assert.match(ui, /rubric: defaultRubric\(genre, Number\(grade\)\)/, "builds the default rubric");
});
