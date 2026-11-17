// Writing "Add student work" uses the class-set camera (Michael Zotzman,
// grade 4 ELA, Android — 5 and 16 Nov 2026). Proven when the writing responses
// tab opens the class-set camera (ScanCamera mode="class") by default, captures
// several pages per student with "Next student", matches pages to students the
// same way the math/reading class set does (resolveScannedGroups), and sends
// each student's pages to the existing writing/rubric grading path (mode
// "writing" → replaceWritingResponses), with the one-student panel kept as a
// secondary option. Fails on main (the class-set component does not exist there
// and the writing responses tab renders only the one-student panel).
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);
function bundle(entry) {
  const r = buildSync({
    entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, absWorkingDir: ROOT,
    alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

test("the writing responses tab opens the class-set camera by default, one-student second", () => {
  const src = readFileSync("components/teacher-assessments.tsx", "utf8");
  assert.match(src, /import \{ WritingClassScan \} from "\.\/writing-class-scan"/);
  // Default is the class set; the one-student panel is the secondary option.
  assert.match(src, /useState<"class" \| "single">\("class"\)/);
  assert.match(src, /writingUpload === "class" \? \(\s*<WritingClassScan/);
  assert.match(src, /onUseSingle=\{\(\) => setWritingUpload\("single"\)\}/);
  assert.match(src, /<WritingReview[\s\S]*?onUseClassSet=\{\(\) => setWritingUpload\("class"\)\}/);
});

test("the class-set writing component reuses the class camera and the writing grading path", () => {
  const src = readFileSync("components/writing-class-scan.tsx", "utf8");
  // The class-set camera COMPONENT, not forked.
  assert.match(src, /<ScanCamera\s+mode="class"/);
  assert.match(src, /Add student work/);
  // Matched the same way as a math/reading class set.
  assert.match(src, /resolveScannedGroups\(/);
  assert.match(src, /planNameBatches\(|mergeNameReads\(/);
  // Each student's pages go to the existing writing/rubric grading path.
  assert.match(src, /mode: "writing"/);
  assert.match(src, /replaceWritingResponses\(/);
  // NOT the answer-key save path, and no second page reservation (the writing
  // grading calls charge themselves — no double charge).
  assert.doesNotMatch(src, /applyScannedGroups/);
  assert.doesNotMatch(src, /scans\/reserve/);
});

test("pages are grouped per student exactly as captured: 2 students × 3 pages", () => {
  const { groupPagesByCapture } = bundle("lib/teacher-class-scan.ts");
  // The capture hands back one group per student ("Next student"); the sizes
  // become index groups the name pass and matching use. Two 3-page essays map
  // to pages [0,1,2] and [3,4,5] — each student's own three pages, no mixing.
  assert.deepEqual(groupPagesByCapture([3, 3]), [[0, 1, 2], [3, 4, 5]]);
  assert.deepEqual(groupPagesByCapture([2, 3, 1]), [[0, 1], [2, 3, 4], [5]]);
});
