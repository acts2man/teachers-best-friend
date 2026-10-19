// Ricky, 19 Oct 2026: every mastery level has a next step.
//   Beginning   -> "Reteach"
//   Approaching -> "Offer targeted practice"
//   Proficient  -> "Offer optional reinforcement"
//   Exceeding   -> "Offer extension activity"
// They live in lib/mastery-levels.ts, the class-analysis card shows the
// matching button for every level it lists, and each opens the same lesson
// generation with that intent. Made-up data only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
function bundle(entry) {
  const r = buildSync({
    entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, absWorkingDir: ROOT,
    alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}
const levels = bundle("lib/mastery-levels.ts");
const { buildPrompt, analyzeInput } = bundle("lib/analyze-shared.ts");

test("each level has its next step and lesson intent", () => {
  assert.deepEqual(
    levels.MASTERY_LEVELS.map((l) => [l.level, l.nextStep.label, l.nextStep.intent]),
    [
      ["Beginning", "Reteach", "reteach"],
      ["Approaching", "Offer targeted practice", "practice"],
      ["Proficient", "Offer optional reinforcement", "reinforcement"],
      ["Exceeding", "Offer extension activity", "extension"],
    ],
  );
});

test("the lesson request carries the intent, and only a known one", () => {
  const base = { mode: "lesson", standard: "S.1", grade: 4, framework: "Common Core", subject: "Math" };
  for (const intent of ["reteach", "practice", "reinforcement", "extension"])
    assert.equal(analyzeInput.parse({ ...base, intent }).intent, intent);
  assert.equal(analyzeInput.safeParse({ ...base, intent: "anything" }).success, false);
});

test("the lesson prompt is shaped by the intent; no intent is a reteach lesson, as before", () => {
  const s = { code: "S.1", title: "t", subject: "Math", grade: 4, framework: "Common Core", domain: "", cluster: "", summary: "", wording: "w", skills: [], prerequisites: [], next: [], vocabulary: [], misconception: "", example: "", dok: 2, source: "" };
  const w = { assessments: [], students: [], classes: [], lessons: [], customStandards: [s], sharedStandards: [] };
  const task = (intent) => buildPrompt({ mode: "lesson", standard: "S.1", grade: 4, framework: "Common Core", subject: "Math", text: "", ...(intent ? { intent } : {}) }, w, [s], false).task;
  const plain = task();
  assert.match(plain, /misconception/i, "the reteach lesson is unchanged");
  assert.equal(task("reteach"), plain);
  assert.match(task("practice"), /targeted practice/i);
  assert.match(task("reinforcement"), /optional reinforcement/i);
  assert.match(task("extension"), /extension/i);
  for (const i of ["practice", "reinforcement", "extension"]) assert.notEqual(task(i), plain, i);
});

test("the class-analysis card offers each level's next step, opening the lesson with that intent", () => {
  const src = readFileSync("components/teacher-assessments.tsx", "utf8");
  assert.match(src, /l\.nextStep\.label/);
  assert.match(src, /"&intent=" \+\s*l\.nextStep\.intent/);
  assert.doesNotMatch(src, /Extension for Exceeding/, "extension opens the lesson generator now, not Resources");
  const planner = readFileSync("components/teacher-planning.tsx", "utf8");
  assert.match(planner, /params\.get\("intent"\)/);
  assert.match(planner, /intent: lessonIntent/);
});
