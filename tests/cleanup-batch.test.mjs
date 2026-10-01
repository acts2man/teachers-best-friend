// Cleanup batch:
//  1. a standard assigned by the teacher (no AI alignment) shows a dash, not 0%,
//     and is left out of alignment averages;
//  2. answers still waiting on the teacher ("other") are surfaced as "still need
//     grading" and never counted as zero;
//  3. the web manifest is served as application/manifest+json;
//  4. the marketing close names the real free plan (36 credits, not twenty).
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
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

const { alignment, questionAlignment } = bundle("lib/teacher-data.ts");
const { studentReview } = bundle("lib/teacher-workflow.ts");

const q = (id, over = {}) => ({
  id,
  number: Number(id.slice(1)),
  text: id,
  passage: "",
  answer: "a",
  standard: "7.RP.3",
  secondary: "",
  skill: "",
  dok: 1,
  costas: 1,
  alignment: 90,
  improvement: "",
  confidence: 95,
  level: "On grade",
  reasoning: "",
  verified: true,
  excluded: false,
  ...over,
});

// ---------------------------------------------------------------
// Item 1 — assigned-by-teacher questions show a dash, not 0%
// ---------------------------------------------------------------

test("a standard with no AI alignment has no score, not zero", () => {
  assert.equal(questionAlignment(q("q1", { alignment: 0 })), null);
  assert.equal(questionAlignment(q("q1", { alignment: 90 })), 90);
});

test("assigned questions are left out of the average, not counted as 0", () => {
  const a = {
    questions: [q("q1", { alignment: 80 }), q("q2", { alignment: 0 })],
    targetStandards: ["7.RP.3"],
  };
  // Only the AI-scored question counts: 80, not (80+0)/2 = 40.
  assert.equal(alignment(a), 80);
});

test("an assessment with no AI-scored questions has a null average (shows as a dash)", () => {
  const a = {
    questions: [q("q1", { alignment: 0 }), q("q2", { alignment: 0 })],
    targetStandards: ["7.RP.3"],
  };
  assert.equal(alignment(a), null);
});

test("an off-target AI-scored question still counts as 0 (that is a real miss)", () => {
  const a = {
    questions: [q("q1", { alignment: 100, standard: "7.RP.3" }), q("q2", { alignment: 100, standard: "6.NS.1" })],
    targetStandards: ["7.RP.3"],
  };
  assert.equal(alignment(a), 50);
});

// ---------------------------------------------------------------
// Item 2 — undecided answers surface, never count as zero
// ---------------------------------------------------------------

function assessmentWith(responses) {
  return {
    id: "a1",
    questions: [q("q1"), q("q2")],
    responses,
    targetStandards: ["7.RP.3"],
  };
}

test("undecided answers are reported as needing grading, not averaged as zero", () => {
  const r = studentReview(
    assessmentWith([
      { id: "r1", studentId: "s1", questionId: "q1", answer: "a", correct: true, match: 100, confidence: 99, verified: true },
      // "other" verdict: match unset, not verified -- waiting on the teacher.
      { id: "r2", studentId: "s1", questionId: "q2", answer: "b", correct: false, match: undefined, confidence: 99, verified: false },
    ]),
    "s1",
  );
  assert.equal(r.needsGrading, 1, "one answer still needs grading");
  // The score is over the one graded answer (100), not (100+0)/2 = 50.
  assert.equal(r.score, 100);
  assert.equal(r.complete, false);
});

test("the gradebook marks an incomplete student Incomplete, not a partial score", () => {
  const { gradebookCsv } = bundle("lib/teacher-workflow.ts");
  const a = {
    id: "a1",
    classId: "c1",
    title: "Q",
    subject: "Math",
    grade: 7,
    framework: "California",
    createdAt: "",
    status: "Ready",
    source: "manual",
    targetStandards: ["7.RP.3"],
    answerKeyVerified: true,
    uploadIds: [],
    studentUploadIds: {},
    questions: [q("q1"), q("q2")],
    responses: [
      { id: "r1", studentId: "s1", questionId: "q1", answer: "a", correct: true, match: 100, confidence: 99, verified: true },
      { id: "r2", studentId: "s1", questionId: "q2", answer: "b", correct: false, match: undefined, confidence: 99, verified: false },
    ],
  };
  const csv = gradebookCsv(a, [{ id: "s1", classId: "c1", name: "Maria G.", color: "", evidence: [] }]);
  const rows = csv.split("\n").map((l) => l.match(/"([^"]|"")*"/g).map((c) => c.slice(1, -1)));
  assert.deepEqual(rows[0], ["Student", "Q1", "Q2", "Score %", "Reviewed", "Needs grading"]);
  assert.equal(rows[1][3], "Incomplete");
  assert.equal(rows[1][5], "1");
});

// ---------------------------------------------------------------
// Item 3 — manifest Content-Type
// ---------------------------------------------------------------

test("Netlify serves the manifest as application/manifest+json", () => {
  const toml = readFileSync("netlify.toml", "utf8");
  assert.match(toml, /for = "\/manifest\.webmanifest"/);
  assert.match(toml, /Content-Type = "application\/manifest\+json"/);
});

// ---------------------------------------------------------------
// Item 4 — marketing names the real free plan
// ---------------------------------------------------------------

test("the marketing close says 36 free credits, not twenty", () => {
  const page = readFileSync("app/(marketing)/page.tsx", "utf8");
  assert.match(page, /Thirty-six credits free/);
  assert.doesNotMatch(page, /Twenty credits free/);
});
