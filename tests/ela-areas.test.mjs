// ELA has three areas, chosen when the subject is ELA (Sept 28 call): Reading
// comprehension, Writing, Language. Reading and Language grade against an answer
// key like Math; Writing (rubric-based) ships separately, so it is not offered
// in setup yet. Existing ELA assessments (no area) keep working.
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
const { ELA_AREAS, offeredElaAreas, elaAreaLabel, isWritingAssessment, usesPassage } =
  bundle("lib/ela.ts");

test("the area list is the three areas in call order, all now offered", () => {
  assert.deepEqual(ELA_AREAS.map((a) => a.value), ["reading", "writing", "language"]);
  assert.deepEqual(offeredElaAreas().map((a) => a.value), ["reading", "writing", "language"]);
  assert.equal(ELA_AREAS.find((a) => a.value === "writing").available, true);
});

test("elaAreaLabel names an area, and is blank when there is none", () => {
  assert.equal(elaAreaLabel("reading"), "Reading comprehension");
  assert.equal(elaAreaLabel("language"), "Language");
  assert.equal(elaAreaLabel(undefined), "");
  assert.equal(elaAreaLabel("math"), "");
});

test("isWritingAssessment is true only for ELA writing", () => {
  assert.equal(isWritingAssessment({ subject: "ELA", elaArea: "writing" }), true);
  assert.equal(isWritingAssessment({ subject: "ELA", elaArea: "reading" }), false);
  assert.equal(isWritingAssessment({ subject: "Math" }), false);
});

test("a passage belongs on Reading (and back-compat ELA), not Language or Math", () => {
  assert.equal(usesPassage({ subject: "ELA", elaArea: "reading" }), true);
  assert.equal(usesPassage({ subject: "ELA", elaArea: "language" }), false);
  assert.equal(usesPassage({ subject: "ELA", elaArea: "writing" }), false);
  // An ELA assessment made before areas existed keeps offering the passage.
  assert.equal(usesPassage({ subject: "ELA" }), true);
  assert.equal(usesPassage({ subject: "Mixed" }), true);
  assert.equal(usesPassage({ subject: "Math" }), false);
  // A passage already attached is always shown, whatever the area.
  assert.equal(usesPassage({ subject: "ELA", elaArea: "language", passage: "x" }), true);
});

// --- component wiring ---
test("setup shows an ELA area picker only for ELA, and stores it only for ELA", () => {
  const ui = readFileSync("components/teacher-scan.tsx", "utf8");
  assert.match(ui, /subject === "ELA" && \(/, "the area picker is gated to ELA");
  assert.match(ui, /offeredElaAreas\(\)\.map/, "the picker uses the shared area list");
  assert.match(
    ui,
    /elaArea: subject === "ELA" \? elaArea : undefined/,
    "the assessment stores the area only for ELA",
  );
});

test("the assessment detail and list show the ELA area label", () => {
  const ui = readFileSync("components/teacher-assessments.tsx", "utf8");
  assert.match(ui, /elaAreaLabel\(a\.elaArea\)/, "detail eyebrow shows the area");
  assert.match(ui, /elaAreaLabel\(item\.elaArea\)/, "list row shows the area");
  assert.match(ui, /usesPassage\(a\)/, "passage panel is gated by area");
});
