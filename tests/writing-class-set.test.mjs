// Writing "Add student work" is the class-set camera, REBUILT on the existing
// class-set machinery (review of PR #218). The writing responses tab renders the
// same `ClassScanPanel` as a math/reading test; only the grading step branches:
// a writing scan does the name pass + matching, then scores each matched
// student's pages with one `mode: "writing"` rubric call and saves via
// `replaceWritingResponses`. Everything else — the camera's onStudent/onFinish
// (photos never cleared before upload), the scan session + resumeScan, the
// up-front page reservation (402 check), Move/Swap/Undo — is the shared code.
//
// Fails on f595316, where the class set was a separate `writing-class-scan.tsx`
// component that re-solved the camera/match flow and had no reservation,
// session/resume, or duplicate hard-block.
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

const assessments = readFileSync("components/teacher-assessments.tsx", "utf8");
const classScan = readFileSync("components/teacher-class-scan.tsx", "utf8");

test("the writing responses tab renders the shared ClassScanPanel by default, one-student second", () => {
  assert.match(assessments, /import \{ ClassScanPanel \} from "\.\/teacher-class-scan"/);
  // The parallel component is gone.
  assert.doesNotMatch(assessments, /writing-class-scan|WritingClassScan/);
  assert.match(assessments, /useState<"class" \| "single">\("class"\)/);
  assert.match(assessments, /writingUpload === "class" \? \([\s\S]{0,400}?<ClassScanPanel/);
  assert.match(assessments, /onUseSingle=\{\(\) => setWritingUpload\("single"\)\}/);
  assert.match(assessments, /<WritingReview[\s\S]*?onUseClassSet=\{\(\) => setWritingUpload\("class"\)\}/);
});

test("ClassScanPanel reuses the class-set machinery and branches ONLY grading for writing", () => {
  assert.match(classScan, /const writing = isWritingAssessment\(a\)/);
  // Shared machinery (so photos-never-lost, session/resume, reservations, move/swap/undo all hold).
  assert.match(classScan, /onStudent=\{queueCameraStudent\}/);
  assert.match(classScan, /onFinish=\{async \(groups, onLanded, shotIds\)/);
  assert.match(classScan, /resumeScan/);
  assert.match(classScan, /"\/api\/scans\/reserve"/);
  assert.match(classScan, /useScanSession\(/);
  assert.match(classScan, /splitGroup\(|undoLast\(/);
  // The grading branch: reserve in the writing mode, grade per student, rubric save.
  assert.match(classScan, /reserveStack\(ids, writing \? "writing" : "class_scan"\)/);
  assert.match(classScan, /async function gradeWritingAndSave\(/);
  assert.match(classScan, /replaceWritingResponses\(next, row\.studentId, responses, replaceConfirmed\)/);
  // Writing grades NOTHING up front; the match screen shows every pile, and
  // grading is deferred to the per-student rubric calls on save.
  assert.match(classScan, /if \(known && !writing\)/);
  assert.match(classScan, /writing \? \[\] : await \(grading \?\? gradeGroups\(pageGroups\)\)/);
  assert.match(classScan, /showGraded\(pageGroups, names, graded, ids, nameIds, writing\)/);
});

test("must-hold 1: two piles on one student is a HARD block for writing (not just a warning)", () => {
  assert.match(classScan, /const writingDuplicate = writing && \[\.\.\.perStudent\.values\(\)\]\.some\(\(n\) => n > 1\)/);
  // Blocked in the save guard AND on the button.
  assert.match(classScan, /if \(duplicate\) \{[\s\S]{0,160}?Two papers are matched to the same student/);
  assert.match(classScan, /undecided\.length > 0 \|\| writingDuplicate/);
});

test("must-hold 6: credits reserved up front; a dropped scoring call is retried once", () => {
  // The up-front reservation is the shared path (reserveStack in gradePages).
  assert.match(classScan, /const reserved = await reserveStack\(ids, writing \? "writing" : "class_scan"\)/);
  // One retry on the per-student writing call, then that student is left for the teacher.
  assert.match(classScan, /gradeWritingAndSave[\s\S]*?withRetry\([\s\S]*?delays: \[1500\][\s\S]*?retryable: isRetryableAnalyzeError/);
  // A 402 is shown as out-of-credits, not "score by hand".
  assert.match(classScan, /isOutOfScans\(describeFailure\(e, ""\)\)/);
  assert.match(classScan, /run out of scan credits/);
});

test("must-hold 7: overwriting confirmed writing scores asks first (confirmedGradesAtRisk)", () => {
  // In the writing branch, before grading, the same confirm the one-student path uses.
  assert.match(classScan, /if \(writing\) \{[\s\S]*?confirmedGradesAtRisk\(a, scannedIds\)\.answers > 0[\s\S]*?setAskRescan\(scannedIds\)/);
});

test("must-hold 8: per-student page cap is 12 for writing; server caps a request at 24", () => {
  assert.match(classScan, /WRITING_PAGES_PER_STUDENT = 12/);
  // Enforced on the manual add and on the camera handoff.
  assert.match(classScan, /writing && piles\[piles\.length - 1\]\.length \+ files\.length > WRITING_PAGES_PER_STUDENT/);
  assert.match(classScan, /openLen \+ files\.length > WRITING_PAGES_PER_STUDENT/);
  // The analyze schema already caps uploadIds at 24 (server rejects >24).
  const schema = readFileSync("lib/analyze-shared.ts", "utf8");
  assert.match(schema, /uploadIds: z\.array\(z\.string\(\)\)\.max\(24\)/);
});

test("must-hold 10: one call holds all of a student's pages; cost wording is per page", () => {
  // The grading call's uploadIds are the whole pile (row.pageUploadIds), not batched.
  assert.match(classScan, /mode: "writing",\s*\n\s*text: "",\s*\n\s*uploadIds: row\.pageUploadIds/);
  assert.match(classScan, /one credit per page; all of one student's pages are read together in a single call/);
});

// --- must-hold 9: the request bodies add nothing beyond the class-set fields ---
// Capture the two request bodies the writing class set builds and assert their
// exact top-level keys: the `name_strip` pass (matching) and the per-student
// `writing` grade. Neither may carry a roster or a name as text.
function analyzeBodyKeys(src, modeLiteral) {
  const at = src.indexOf(modeLiteral);
  assert.ok(at >= 0, "expected an analyzeRequest with " + modeLiteral);
  const call = src.lastIndexOf("analyzeRequest(", at);
  assert.ok(call >= 0, "expected analyzeRequest( before " + modeLiteral);
  const braceStart = src.indexOf("{", call);
  let depth = 0, end = braceStart;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  const obj = src.slice(braceStart + 1, end).replace(/\/\/[^\n]*/g, "");
  const keys = new Set();
  let d = 0;
  for (const m of obj.matchAll(/\{|\}|([A-Za-z_]\w*)\s*:/g)) {
    if (m[0] === "{") d++;
    else if (m[0] === "}") d--;
    else if (m[1] && d === 0) keys.add(m[1]);
  }
  return keys;
}

test("must-hold 9: name_strip and writing request bodies carry no roster and no name as text", () => {
  const nameStrip = analyzeBodyKeys(classScan, 'mode: "name_strip"');
  assert.deepEqual(
    [...nameStrip].sort(),
    ["assessmentId", "framework", "grade", "mode", "subject", "uploadIds"],
    "name_strip sends only these fields",
  );
  const writing = analyzeBodyKeys(classScan, 'mode: "writing"');
  // The writing grade adds only what the one-student writing path already
  // sends: text (empty notes) and studentId (an opaque id the server checks and
  // never puts in the prompt). Nothing roster- or name-shaped.
  assert.deepEqual(
    [...writing].sort(),
    ["assessmentId", "framework", "grade", "mode", "studentId", "subject", "text", "uploadIds"],
    "writing sends only the documented fields",
  );
  for (const body of [nameStrip, writing]) {
    for (const forbidden of ["rosterNames", "names", "studentName", "name", "roster"]) {
      assert.ok(!body.has(forbidden), "no " + forbidden + " in the request body");
    }
  }
});

test("pages are grouped per student exactly as captured: 2 students × 3 pages", () => {
  const { groupPagesByCapture } = bundle("lib/teacher-class-scan.ts");
  assert.deepEqual(groupPagesByCapture([3, 3]), [[0, 1, 2], [3, 4, 5]]);
  assert.deepEqual(groupPagesByCapture([2, 3, 1]), [[0, 1], [2, 3, 4], [5]]);
});
