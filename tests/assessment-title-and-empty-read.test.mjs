// A worksheet read must never hand the save path something the database will
// reject, and a read that finds nothing must not become a saved assessment.
//
// Live bug (build 021726d): a photo that was not a worksheet read correctly as
// zero questions, but the model put its explanation in the title (273 chars).
// The save then failed assessments_title_check (1-200 chars) and the teacher
// saw the generic "We couldn't complete that request" error.
//
// These bundle the real analyze-shared so a future edit that drops the title
// clamp, or stops telling the model the title is a short name, fails here.
import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import path from "node:path";

const ROOT = process.cwd();
const result = buildSync({
  entryPoints: ["lib/analyze-shared.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  absWorkingDir: ROOT,
  alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
});
const shim = { exports: {} };
new Function("module", "exports", result.outputFiles[0].text)(shim, shim.exports);
const { buildPrompt, finalizeAnalysis, analyzeInput } = shim.exports;

const catalog = [
  {
    code: "4.NF.1",
    title: "Equivalent fractions",
    subject: "Math",
    grade: 4,
    framework: "California",
    domain: "",
    cluster: "",
    wording: "w",
  },
];
const workspace = { assessments: [], students: [], classes: [], lessons: [] };

const assignmentParams = analyzeInput.parse({
  mode: "assignment",
  grade: 4,
  subject: "Math",
  framework: "California",
  targetStandards: ["4.NF.1"],
});

test("the assignment prompt tells the model the title is a short name, not an explanation", () => {
  const { task } = buildPrompt(assignmentParams, workspace, catalog, true);
  assert.match(task, /title is a short name/i);
  assert.match(task, /never a sentence, an explanation/i);
});

test("an over-long AI title is clamped so the save can never fail the 1-200 check", () => {
  // The exact shape of the live failure: a 273-char explanation in the title.
  const longTitle = "This document appears to be a personal letter about a cruise ".repeat(
    5,
  );
  assert.ok(longTitle.length > 200, "the test title must exceed the DB limit");
  const output = finalizeAnalysis(
    assignmentParams,
    { title: longTitle, questions: [] },
    workspace,
    catalog,
  );
  assert.ok(output.title.length <= 120, "title should be clamped to 120");
  assert.ok(output.title.length >= 1, "a clamped title is still non-empty");
});

test("a short title is left exactly as the model wrote it", () => {
  const output = finalizeAnalysis(
    assignmentParams,
    { title: "  Unit 3 Fractions Quiz  ", questions: [] },
    workspace,
    catalog,
  );
  assert.equal(output.title, "Unit 3 Fractions Quiz");
});

test("a read that finds no questions returns an empty question list, not a fabricated one", () => {
  // The client and both server paths key off exactly this: questions.length===0
  // means show a message and release the charge, never save an empty assessment.
  const output = finalizeAnalysis(
    assignmentParams,
    { title: "Cruise letter", questions: [] },
    workspace,
    catalog,
  );
  assert.ok(Array.isArray(output.questions));
  assert.equal(output.questions.length, 0);
});
