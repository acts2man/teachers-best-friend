// Regression (live, 8 Oct): Michael could not open an assessment -- "I click
// review student work and nothing happens." Root cause: get_workspace_json wraps
// each assessment in jsonb_strip_nulls, so an assessment whose target_standards
// column is NULL (a freshly scanned one, before standards are chosen) comes back
// with NO `targetStandards` key. The Assessment type says it is always present
// and the assessment views read `a.targetStandards.length` / `.includes` /
// `.map`, so the missing key threw "Cannot read properties of undefined (reading
// 'length')" during render and the whole screen was replaced by the error
// boundary -- which looks like "nothing happens."
//
// Fix: default every strippable assessment field at the edge, where the
// workspace enters the app (server normalizeWorkspace AND the client fetch).
//
// Second bug, same data: with no answerRegion (every answer graded before #108),
// the grade-by-question photo fell back to studentUploadIds[studentId][0] --
// always page 1 -- so a page-2 question couldn't be seen on a two-page test. Fix:
// no region -> show the whole, page-able work (page tabs in the thumbnail and in
// the full-size viewer), never a guessed page.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";

const require = createRequire(import.meta.url);
function bundle(entry) {
  const r = buildSync({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs",
    write: false, absWorkingDir: process.cwd() });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}
const { withAssessmentDefaults, withWorkspaceDefaults } = bundle("lib/workspace-safety.ts");

// ---------------------------------------------------------------
// The fix: strippable fields default at the edge
// ---------------------------------------------------------------

test("an assessment with no targetStandards key becomes [] (the crash's exact shape)", () => {
  // Exactly what jsonb_strip_nulls leaves when target_standards is NULL: the key
  // is simply absent.
  const a = { id: "scan-1-1", title: "scan-1-1", questions: [], responses: [], uploadIds: [] };
  const safe = withAssessmentDefaults(a);
  assert.deepEqual(safe.targetStandards, [], "targetStandards is an array, not undefined");
  // The reads that crashed are now safe.
  assert.doesNotThrow(() => safe.targetStandards.length);
  assert.doesNotThrow(() => safe.targetStandards.includes("x"));
  assert.doesNotThrow(() => safe.targetStandards.map((s) => s));
});

test("existing values are preserved, not overwritten", () => {
  const a = withAssessmentDefaults({
    targetStandards: ["4.NBT.B.4", "4.OA.1"], uploadIds: ["u1"],
    questions: [{ id: "q1" }], responses: [{ id: "r1" }],
  });
  assert.deepEqual(a.targetStandards, ["4.NBT.B.4", "4.OA.1"]);
  assert.deepEqual(a.uploadIds, ["u1"]);
  assert.equal(a.questions.length, 1);
  assert.equal(a.responses.length, 1);
});

test("every strippable array defaults, so no assessment screen white-screens", () => {
  const a = withAssessmentDefaults({ id: "x" });
  assert.deepEqual(a.targetStandards, []);
  assert.deepEqual(a.uploadIds, []);
  assert.deepEqual(a.questions, []);
  assert.deepEqual(a.responses, []);
});

test("withWorkspaceDefaults fixes every assessment in the workspace", () => {
  const w = withWorkspaceDefaults({
    assessments: [{ id: "a1" }, { id: "a2", targetStandards: ["s"] }],
    students: [{ id: "s1" }],
  });
  assert.deepEqual(w.assessments[0].targetStandards, []);
  assert.deepEqual(w.assessments[1].targetStandards, ["s"]);
  // A workspace with no assessments array doesn't throw either.
  assert.deepEqual(withWorkspaceDefaults({}).assessments, []);
});

// ---------------------------------------------------------------
// The fix is wired at both boundaries (source assertions)
// ---------------------------------------------------------------

test("the server normalizes assessments on every workspace read", () => {
  const src = readFileSync("lib/teacher-server.ts", "utf8");
  assert.match(src, /withAssessmentDefaults/, "normalizeWorkspace applies the defaults");
  assert.match(src, /from "@\/lib\/workspace-safety"/);
});

test("the client normalizes the workspace it fetches (defense in depth)", () => {
  const src = readFileSync("components/teacher-app.tsx", "utf8");
  assert.match(src, /withWorkspaceDefaults\(d\.workspace\)/, "the fetched workspace is defaulted before use");
});

// ---------------------------------------------------------------
// Bug 2: no region -> page-able work, never a guessed page 1
// ---------------------------------------------------------------

const review = readFileSync("components/teacher-review.tsx", "utf8");
const viewer = readFileSync("components/image-viewer.tsx", "utf8");

test("a photo is cropped ONLY when the answer area is known (has a region)", () => {
  // photoOf no longer falls back to studentUploadIds[..][0] (which was always
  // page 1); with no region it returns null so the page-able view is shown.
  assert.match(review, /const uploadId = r\.answerRegion\?\.uploadId;/);
  assert.doesNotMatch(review, /r\.answerRegion\?\.uploadId \?\? a\.studentUploadIds/);
});

test("without a region the teacher pages through the whole of that student's work", () => {
  assert.match(review, /function StudentWorkPhoto\(/, "a page-able per-student view exists");
  assert.match(review, /<StudentWorkPhoto/, "it is used where there is no region");
  // Its thumbnail has page tabs, and its full-size viewer is given every page.
  assert.match(review, /Show page " \+ \(i \+ 1\) \+ " of this student's work/);
});

test("the full-size viewer can page between a student's pages", () => {
  assert.match(viewer, /pages\?: string\[\]/, "ImageViewer accepts multiple pages");
  assert.match(viewer, /image-viewer-pages/, "it renders page tabs");
  assert.match(review, /pages=\{pages\}/, "GroupWorkSample hands its pages to the viewer");
  const css = readFileSync("app/globals.css", "utf8");
  assert.match(css, /\.image-viewer-page\{/, "the page tabs are styled");
});

test("the cropped-photo path (a known region, newer scans) still renders", () => {
  assert.match(review, /<CroppedPhoto/);
});
