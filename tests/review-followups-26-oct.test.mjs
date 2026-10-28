// Reviewer follow-ups (26 Oct 2026):
//   a. findUploadByHash never returns a row the 30-day purge emptied;
//   b. one live teacher_uploads row per owner + content hash -- a retried POST
//      reuses the row instead of adding a second (migration 20261026120000) --
//      and, since the same bytes are now one upload, deleting a test (or
//      clearing / removing a class) never deletes a page another test uses;
//   c. a lesson planned from a DOK cell aims at that cell's own common errors,
//      even when it is pitched a level up (extension) or the teacher ticks
//      other levels -- what the panel showed.
// Made-up data only (rule R8).
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
const classes = bundle("lib/teacher-classes.ts");
const { lessonFocus } = bundle("lib/teacher-class-analysis.ts");

test("a: a purged upload is never found by its hash", () => {
  const src = readFileSync("lib/teacher-server.ts", "utf8");
  const fn = src.slice(src.indexOf("export async function findUploadByHash"), src.indexOf("export async function deleteDocument"));
  assert.match(fn, /\.eq\("content_sha256", sha256\)[\s\S]*\.is\("purged_at", null\)/);
});

test("b: the migration keeps one live row per owner + hash and reuses it on insert", () => {
  const sql = readFileSync("supabase/migrations/20261026120000_teacher_uploads_one_live_row_per_hash.sql", "utf8");
  assert.match(sql, /create unique index if not exists teacher_uploads_one_live_row_per_hash\s+on public\.teacher_uploads \(owner_id, content_sha256\)\s+where purged_at is null and superseded_by is null;/);
  assert.match(sql, /set superseded_by = r\.keep[\s\S]*r\.rn > 1;/, "existing duplicates are marked, not deleted");
  assert.doesNotMatch(sql, /delete from public\.teacher_uploads/i);
  assert.match(sql, /before insert on public\.teacher_uploads\s+for each row execute function public\.teacher_uploads_reuse_live_row\(\);/);
  assert.match(sql, /return null; -- no second row/);
  readFileSync("supabase/checks/teacher-uploads-one-row-per-hash.sql", "utf8");
});

test("b: the server answers with the row actually kept", () => {
  const server = readFileSync("lib/teacher-server.ts", "utf8");
  assert.match(server, /\}\)\.select\("id"\);/, "the insert says whether it wrote a row");
  assert.match(server, /if \(Array\.isArray\(inserted\) && inserted\.length === 0\) \{[\s\S]*?findUploadByHash\(ownerId, sha256\)/);
  assert.match(server, /if \(rowError\.code === "23505"\) \{[\s\S]*?findUploadByHash\(ownerId, sha256\)/);
  const route = readFileSync("app/api/uploads/route.ts", "utf8");
  assert.match(route, /id: saved\.id,/);
  assert.match(route, /pages: saved\.pageCount,/);
});

const a = (id, extra) => ({ id, classId: "c1", title: id, questions: [], responses: [], uploadIds: [], ...extra });
const w = (assessments, extra = {}) => ({ classes: [], students: [], assessments, lessons: [], resources: [], groups: [], ...extra });

test("b: deleting a test keeps a page another test still uses", () => {
  const ws = w([
    a("t1", { uploadIds: ["shared", "only-t1"], answerKeyUploadIds: ["key1"], studentUploadIds: { s1: ["page1"] } }),
    a("t2", { uploadIds: ["shared"], studentUploadIds: { s2: ["page1"] } }),
  ]);
  const { uploadIds } = classes.deleteAssessment(ws, "t1");
  assert.deepEqual(uploadIds.sort(), ["key1", "only-t1"]);
  assert.deepEqual(classes.uploadsNoLongerUsed(ws, ["shared", "gone"]), ["gone"]);
  assert.deepEqual(classes.uploadsNoLongerUsed(w([], { resources: [{ uploadId: "res" }] }), ["res"]), [], "a resource keeps its file");
});

test("b: clearing a class keeps a page another class's student still uses", () => {
  const ws = w(
    [a("t1", { uploadIds: [], studentUploadIds: { s1: ["p1", "both"], s2: ["both"] } })],
    { students: [{ id: "s1", classId: "c1", evidence: [] }, { id: "s2", classId: "c2", evidence: [] }] },
  );
  assert.deepEqual(classes.clearClassStudents(ws, "c1").uploadIds, ["p1"]);
});

test("b: removing a class keeps the pages of a test it shares with another class", () => {
  const src = readFileSync("components/teacher-classes.tsx", "utf8");
  assert.match(src, /if \(await save\(next, "Class removed"\)\)/);
  assert.match(src, /deleteUploads\(uploadsNoLongerUsed\(next, uploads\)\)/);
});

test("c: an extension pitched at DOK 3 aims at the DOK 2 cell's errors", () => {
  const q = (id, dok) => ({ id, number: 1, standard: "A.1", dok, verified: true, excluded: false });
  const r = (id, qid, errorType) => ({ id, studentId: "s" + id, questionId: qid, correct: false, match: 0, verified: true, errorType });
  const t = {
    id: "t", subject: "Math", questions: [q("q1", 2), q("q2", 3)],
    responses: [r("1", "q1", "Sign Error"), r("2", "q1", "Sign Error"), r("3", "q2", "Setup/Method Error")],
  };
  assert.deepEqual(lessonFocus(t, "A.1", [3], [2]), { dok: [3], errorTypes: [{ name: "Sign Error", count: 2 }] });
  assert.deepEqual(lessonFocus(t, "A.1", [2, 3], [2]).errorTypes, [{ name: "Sign Error", count: 2 }], "an extra level ticked: still the cell's errors");
  assert.deepEqual(lessonFocus(t, "A.1", [3]).errorTypes, [{ name: "Setup/Method Error", count: 1 }], "no cell given: the lesson's own levels, as before");
  const panel = readFileSync("components/dok-cell-panel.tsx", "utf8");
  assert.match(panel, /"&errorsFrom=" \+\s+cell\.dok/);
  const planning = readFileSync("components/teacher-planning.tsx", "utf8");
  assert.match(planning, /lessonFocus\(sourceAssessment, standard, dokLevels, errorsFrom\)/);
});
