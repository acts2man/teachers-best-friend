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

// ---- the last delete path, and a server that cannot be bypassed (27 Oct) ----

test("an answer's crop counts as using its page", () => {
  const w = ws([{ id: "t", uploadIds: [], studentUploadIds: {}, responses: [{ answerRegion: { uploadId: "page" } }] }]);
  assert.deepEqual(uploadsNoLongerUsed(w, ["page"]), []);
});

test("the setup screen's remove-file X asks first, counting the files still listed", () => {
  const scan = readFileSync("components/teacher-scan.tsx", "utf8");
  assert.match(scan, /deleteUploads\(\s*uploadsNoLongerUsed\(\s*w,\s*\[f\.id\],\s*files\.filter\(\(x\) => x !== f\)\.map\(\(x\) => x\.id\),\s*\),\s*\)/);
});

test("no code sends DELETE /api/uploads/<id> itself: only deleteUploads does", async () => {
  const { readdirSync, statSync } = await import("node:fs");
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = dir + "/" + name;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name)) files.push(p);
    }
  };
  for (const dir of ["components", "lib", "app", "hooks"]) {
    try {
      walk(dir);
    } catch {}
  }
  const offenders = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    // Any fetch whose URL names the uploads route and whose options say DELETE.
    for (const m of src.matchAll(/fetch\(\s*([^,)]*)/g)) {
      if (!/api\/uploads/.test(m[1])) continue;
      const opts = src.slice(m.index, m.index + 300);
      if (/method:\s*["']DELETE["']/.test(opts) && f !== "lib/connection.ts") offenders.push(f + ": " + m[0]);
    }
  }
  assert.deepEqual(offenders, []);
  // And deleteUploads itself is the one place, fetching per id.
  assert.match(readFileSync("lib/connection.ts", "utf8"), /fetch\("\/api\/uploads\/" \+ encodeURIComponent\(id\), \{\s*method: "DELETE",/);
});

test("the server refuses (409) to delete a file something still uses", () => {
  const route = readFileSync("app/api/uploads/[id]/route.ts", "utf8");
  const del = route.slice(route.indexOf("export async function DELETE"));
  assert.ok(del.indexOf("uploadStillReferenced(ownerId, id)") > 0 && del.indexOf("uploadStillReferenced(ownerId, id)") < del.indexOf("deleteDocument(ownerId, id)"), "checked before deleting");
  assert.match(del, /throw new HttpError\(409,/);
  const server = readFileSync("lib/teacher-server.ts", "utf8");
  const fn = server.slice(server.indexOf("export async function uploadStillReferenced("), server.indexOf("export async function deleteDocument("));
  assert.match(fn, /uploadsNoLongerUsed\(saved\.data, \[id\]\)\.length === 0/, "the workspace, by the same rule as the app");
  assert.match(fn, /\.from\("class_scan_sessions"\)/, "and a class scan in progress");
  // A kept file is not a failed delete.
  assert.match(readFileSync("lib/connection.ts", "utf8"), /return r\.ok \|\| r\.status === 404 \|\| r\.status === 409;/);
});

test("the migration never says DROP, even in a comment", () => {
  const sql = readFileSync("supabase/migrations/20261026120000_teacher_uploads_one_live_row_per_hash.sql", "utf8");
  assert.doesNotMatch(sql, /drop/i);
});

test("DELETE /api/uploads/<id> answers 409 and deletes nothing while the file is in use", async () => {
  const { build } = await import("esbuild");
  const calls = [];
  globalThis.__uploadStub = { referenced: true, calls };
  const stub = `
    export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
    const s = globalThis.__uploadStub;
    export const guardOrigin = () => {};
    export const owningTeacherId = async () => "t1";
    export const writingTeacherId = async () => "t1";
    export const readDocument = async () => null;
    export const uploadStillReferenced = async (owner, id) => { s.calls.push(["check", owner, id]); return s.referenced; };
    export const deleteDocument = async (owner, id) => { s.calls.push(["delete", owner, id]); return true; };
    export const apiError = (e) => Response.json({ error: e.message }, { status: e.status ?? 500 });
  `;
  const r = await build({
    entryPoints: ["app/api/uploads/[id]/route.ts"],
    bundle: true, platform: "node", format: "cjs", write: false,
    plugins: [{ name: "stub", setup(b) {
      b.onResolve({ filter: /^@\/lib\/teacher-server$/ }, () => ({ path: "stub", namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: stub, loader: "js" }));
    } }],
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, (await import("node:module")).createRequire(import.meta.url));
  const call = () => m.exports.DELETE(new Request("https://x/api/uploads/u1", { method: "DELETE" }), { params: Promise.resolve({ id: "u1" }) });
  let res = await call();
  assert.equal(res.status, 409);
  assert.deepEqual(calls, [["check", "t1", "u1"]], "never reached deleteDocument");
  globalThis.__uploadStub.referenced = false;
  calls.length = 0;
  res = await call();
  assert.equal(res.status, 200);
  assert.deepEqual(calls, [["check", "t1", "u1"], ["delete", "t1", "u1"]]);
});
