// One upload row per identical file (#176): the same bytes uploaded twice are
// ONE row, so a file can belong to a test, its passage read, a student's
// photo and a roster at once. Every delete therefore asks uploadsNoLongerUsed
// first. scripts/browser-check/shared-upload-passage.mjs drives the passage
// case: a test made from a PDF, the same PDF read as its passage, and the
// test's file still opens.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";

function bundle(path) {
  const r = buildSync({ entryPoints: [path], bundle: true, platform: "node", format: "cjs", write: false });
  const m = { exports: {} };
  new Function("module", "exports", r.outputFiles[0].text)(m, m.exports);
  return m.exports;
}
const { uploadsNoLongerUsed } = bundle("lib/teacher-classes.ts");
const ws = (assessments) => ({ assessments, resources: [] });

test("a passage read from the test's own PDF deletes nothing", () => {
  const w = ws([{ id: "t", uploadIds: ["pdf"], assignmentUploadIds: ["pdf"], answerKeyUploadIds: [], studentUploadIds: {} }]);
  assert.deepEqual(uploadsNoLongerUsed(w, ["pdf"]), []);
  assert.deepEqual(uploadsNoLongerUsed(w, ["pdf", "other"]), ["other"]);
});

test("while a test is still being set up, its pages count as in use", () => {
  assert.deepEqual(uploadsNoLongerUsed(ws([]), ["pdf"], ["pdf"]), []);
  assert.deepEqual(uploadsNoLongerUsed(ws([]), ["pdf"]), ["pdf"]);
});

test("a released student photo that another student's work shares is kept", () => {
  const w = ws([
    { id: "t1", uploadIds: [], studentUploadIds: { s1: [] } },
    { id: "t2", uploadIds: [], studentUploadIds: { s9: ["photo"] } },
  ]);
  assert.deepEqual(uploadsNoLongerUsed(w, ["photo"]), []);
});

test("every delete in the app goes through it", () => {
  const read = (f) => readFileSync(f, "utf8");
  assert.match(read("components/teacher-assessments.tsx"), /await deleteUploads\(uploadsNoLongerUsed\(w, ids\)\);/);
  assert.match(read("components/teacher-scan.tsx"), /deleteUploads\(\s*uploadsNoLongerUsed\(w, ids, files\.map\(\(f\) => f\.id\)\),\s*\)/);
  assert.match(read("components/teacher-review.tsx"), /deleteUploads\(\s*uploadsNoLongerUsed\(\s*\{ \.\.\.w, assessments: w\.assessments\.map\(\(x\) => \(x\.id === a\.id \? forgotten : x\)\) \},\s*released,/);
  assert.match(read("components/teacher-classes.tsx"), /deleteUploads\(uploadsNoLongerUsed\(w, ids\)\)/);
  // No bare delete of raw ids is left anywhere.
  for (const f of ["components/teacher-assessments.tsx", "components/teacher-scan.tsx", "components/teacher-review.tsx", "components/teacher-classes.tsx", "components/teacher-insights.tsx"]) {
    for (const call of read(f).match(/deleteUploads\(\s*[^)]*\)/g) ?? [])
      assert.match(call, /uploadsNoLongerUsed|uploadIds\)|cleared\.uploadIds\)/, `${f}: ${call}`);
  }
});

test("the lookup never reuses a superseded row, and works before the migration", () => {
  const server = readFileSync("lib/teacher-server.ts", "utf8");
  const fn = server.slice(server.indexOf("export async function findUploadByHash("));
  assert.match(fn, /if \(skipSuperseded\) q = q\.is\("superseded_by", null\);/);
  assert.match(fn, /if \(error\?\.code === "42703"\) \(\{ data: row, error \} = await lookup\(false\)\);/);
});

test("the migration replaces the trigger without DROP", () => {
  const sql = readFileSync("supabase/migrations/20261026120000_teacher_uploads_one_live_row_per_hash.sql", "utf8");
  assert.doesNotMatch(sql, /^\s*drop\s/im);
  assert.match(sql, /create or replace trigger teacher_uploads_reuse_live_row/);
});
