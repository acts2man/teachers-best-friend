// Gap G8 (docs/system-map.md, rule R14): two custom standards with the same
// code failed EVERY save. The database keeps one custom standard per code for
// a teacher (custom_standards_key on teacher_id, code); the app keys them by
// framework, grade and code. So a second framework that uses the same codes,
// the same code added by hand under another framework, or an AI catalog answer
// listing a code twice put two rows with one key into the save, and Postgres
// refused the whole statement -- and every save after it, until a reload.
//
// Fixed twice over: sync_workspace keeps the first copy of each code
// (20261014160000), and the two places that add custom standards no longer
// create a second copy. The SQL itself was run on a copy of the production
// functions; see the PR. Made-up standards only (rule R8).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";
import { currentDefinitions, migrationFiles } from "./invariants/lib/workspace-sql.mjs";

function bundle(path) {
  const r = buildSync({ entryPoints: [path], bundle: true, platform: "node", format: "cjs", write: false });
  const m = { exports: {} };
  new Function("module", "exports", r.outputFiles[0].text)(m, m.exports);
  return m.exports;
}
const { addableStandards } = bundle("lib/teacher-catalog.ts");

const std = (code, framework, grade = 3) => ({
  code, framework, grade, title: code, subject: "Math", domain: "", cluster: "", summary: "",
  skills: [], prerequisites: [], next: [], vocabulary: [], misconception: "", example: "", dok: 2, source: "",
});

/** sync_workspace's custom-standards insert, as the database has it after every migration. */
function customStandardsInsert() {
  const def = currentDefinitions(migrationFiles()).sync_workspace;
  const at = def.indexOf("insert into public.standards");
  assert.ok(at >= 0, "sync_workspace writes custom standards");
  return def.slice(at, def.indexOf(";", at));
}

test("G8: the save keeps ONE row per code, so ON CONFLICT never meets the same row twice", () => {
  const sql = customStandardsInsert();
  assert.match(sql, /select\s+distinct\s+on\s*\(\s*cs->>'code'\s*\)/, "one row per code reaches the upsert");
  // The upsert's key must be the distinct-on key, or two rows could still collide.
  assert.match(sql, /on\s+conflict\s*\(\s*teacher_id\s*,\s*code\s*\)/);
  // The FIRST copy in the saved list wins, so the standard already in the
  // library keeps its framework instead of flipping on every save.
  assert.match(sql, /with\s+ordinality\s+as\s+e\s*\(\s*cs\s*,\s*n\s*\)/);
  assert.match(sql, /order\s+by\s+cs->>'code'\s*,\s*n\b/);
});

test("G11: the custom-standards upsert writes meta and updates it", () => {
  const sql = customStandardsInsert();
  assert.match(sql, /cluster,\s*meta\)/);
  assert.match(sql, /meta\s*=\s*excluded\.meta/);
});

test("a code the library holds under another framework is not added again", () => {
  const library = [std("3.OA.A.1", "Ohio")];
  const { added, heldElsewhere } = addableStandards(library, [std("3.OA.A.1", "Utah"), std("3.OA.A.2", "Utah")]);
  assert.deepEqual(added.map((s) => s.code), ["3.OA.A.2"]);
  assert.deepEqual(heldElsewhere.map((s) => s.framework), ["Ohio"], "the teacher is told where it already is");
});

test("a code listed twice in one catalog answer is added once", () => {
  const { added, heldElsewhere } = addableStandards([], [std("3.OA.A.1", "Utah"), std("3.OA.A.1", "Utah")]);
  assert.equal(added.length, 1);
  assert.equal(heldElsewhere.length, 0, "not reported as held elsewhere: it is the same standard");
});

test("a code already held under the same framework and grade is skipped silently, as before", () => {
  const { added, heldElsewhere } = addableStandards([std("3.OA.A.1", "Utah")], [std("3.OA.A.1", "Utah")]);
  assert.equal(added.length, 0);
  assert.equal(heldElsewhere.length, 0);
});

test("a code held elsewhere and listed twice is reported once", () => {
  const { heldElsewhere } = addableStandards([std("4.OA.A.1", "Ohio")], [std("4.OA.A.1", "Utah"), std("4.OA.A.1", "Utah")]);
  assert.equal(heldElsewhere.length, 1);
});

test("both places that add custom standards go through the one-per-code rule", () => {
  const loader = readFileSync("components/teacher-classes.tsx", "utf8");
  assert.match(loader, /const fit = addableStandards\(\[\.\.\.w\.customStandards, \.\.\.added\], d\.result\.standards as Standard\[\]\);/);
  // What is saved is what the rule let through, not the raw answer.
  assert.match(loader, /added = \[\.\.\.added, \.\.\.fit\.added\];/);
  assert.doesNotMatch(loader, /d\.result\.standards as Standard\[\]\)\.filter/);
  const add = readFileSync("components/teacher-insights.tsx", "utf8");
  assert.match(add, /w\.customStandards\.find\(\(s\) => s\.code === code\.trim\(\)\)/);
});
