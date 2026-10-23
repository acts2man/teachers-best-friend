// A whole-test points total that is not a whole number (2.5) was lost on
// save: assessments.points_possible was `integer` and sync_workspace wrote it
// with safe_int, which turns '2.5' into NULL. Migration 20261020130000 makes
// the column numeric and writes it with safe_numeric, keeping only a total
// above 0 and at most 1,000,000, rounded to 0.01. Proven on the database by
// supabase/checks/points-possible-round-trip.sql (run by the reviewer).
// Made-up data only (rule R8).
import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { migrationFiles, currentDefinitions } from "./invariants/lib/workspace-sql.mjs";

function bundle(path) {
  const r = buildSync({ entryPoints: [path], bundle: true, platform: "node", format: "cjs", write: false });
  const m = { exports: {} };
  new Function("module", "exports", r.outputFiles[0].text)(m, m.exports);
  return m.exports;
}
const { setQuestionPoints } = bundle("lib/teacher-workflow.ts");

test("the app makes decimal totals: a question worth half a point gives 2.5", () => {
  const q = (id) => ({ id, number: 1, standard: "S.1", dok: 1, verified: true, excluded: false });
  const a = { id: "a1", questions: [q("q1"), q("q2"), q("q3")], responses: [] };
  const next = setQuestionPoints(a, "q3", 0.5);
  assert.equal(next.pointsPossible, 2.5, "1 + 1 + 0.5");
});

const files = migrationFiles();
const defs = currentDefinitions(files);

test("sync_workspace writes the total as a number with decimals, not an integer", () => {
  const sync = defs.sync_workspace;
  assert.doesNotMatch(sync, /safe_int\(a->>'pointsPossible'\)/, "safe_int drops 2.5");
  assert.match(
    sync,
    /case when public\.safe_numeric\(a->>'pointsPossible'\) > 0 and public\.safe_numeric\(a->>'pointsPossible'\) <= 1000000 then trim_scale\(round\(public\.safe_numeric\(a->>'pointsPossible'\), 2\)\) end/,
  );
  assert.match(defs.get_workspace_json, /'pointsPossible', a\.points_possible/, "read back unchanged");
});

test("the column ends up numeric", () => {
  // Replay the column's type through the migrations, in order.
  let type = null;
  for (const { text } of files) {
    for (const m of text.matchAll(/add column if not exists points_possible (\w+)|alter column points_possible type (\w+)/gi))
      type = (m[2] ?? (type === null ? m[1] : type)).toLowerCase();
  }
  assert.equal(type, "numeric");
});
