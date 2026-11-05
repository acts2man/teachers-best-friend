// "Record exit check" on a whole-class lesson (review of #198). Since #198 a
// lesson saves with no student or group picked ("Whole class"), and its exit
// check then opened an empty list -- nothing could be recorded. Proven when a
// whole-class lesson's exit check lists every student in the lesson's class
// (only that class, by name), and a lesson for chosen students still lists
// just them. Placeholder names only (R8).
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
const L = bundle("lib/teacher-lessons.ts");
const students = [
  { id: "s1", classId: "c1", name: "Cara" },
  { id: "s2", classId: "c1", name: "ana" },
  { id: "s3", classId: "c2", name: "Ben" },
];

test("a whole-class lesson lists its class, by name; a lesson for chosen students lists them", () => {
  assert.deepEqual(L.exitCheckStudents({ studentIds: [], classId: "c1" }, students).map((s) => s.id), ["s2", "s1"]);
  assert.deepEqual(L.exitCheckStudents({ studentIds: ["s1"], classId: "c1" }, students).map((s) => s.id), ["s1"]);
  assert.deepEqual(L.exitCheckStudents({ studentIds: ["gone", "s3"], classId: "c1" }, students).map((s) => s.id), ["s3"], "a removed student is skipped");
  assert.deepEqual(L.exitCheckStudents({ studentIds: [], classId: "c9" }, students), []);
});

test("the exit check dialog uses it", () => {
  const src = readFileSync("components/teacher-planning.tsx", "utf8");
  assert.match(src, /exitCheckStudents\(checkLesson, w\.students\)/);
  assert.match(src, /A whole-class lesson: everyone in the class is listed\./);
});
