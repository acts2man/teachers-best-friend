// Grading mode per class (Ricky, 27 Oct 2026). Proven when: a class's mode is
// chosen when it is created (both "create a class" forms) and saved; every new
// test in the class takes it, with no choice at test setup; a test keeps its
// own mode; a class made before this reads as Standards-Based only when it has
// tests and all of them are; and the migration writes that same rule, patches
// both workspace functions, and comes with a rolled-back check.
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
const { classGradingMode, gradingModeName } = bundle("lib/grading-mode.ts");
const t = (id, classId, extra = {}) => ({ id, classId, ...extra });

test("a class's own mode wins; a class from before reads by its tests", () => {
  const w = {
    assessments: [
      t("a1", "all-sbg", { gradingMode: "sbg" }),
      t("a2", "elsewhere", { gradingMode: "sbg", classIds: ["elsewhere", "all-sbg"] }), // shared into it
      t("a3", "mixed", { gradingMode: "sbg" }),
      t("a4", "mixed"),
      t("a5", "pct"),
    ],
  };
  assert.equal(classGradingMode(w, { id: "all-sbg" }), "sbg", "every test Standards-Based");
  assert.equal(classGradingMode(w, { id: "mixed" }), "percentage", "one Percentage test is enough");
  assert.equal(classGradingMode(w, { id: "pct" }), "percentage");
  assert.equal(classGradingMode(w, { id: "empty" }), "percentage", "no tests: Percentage");
  assert.equal(classGradingMode(w, { id: "mixed", gradingMode: "sbg" }), "sbg", "chosen at creation wins");
  assert.equal(classGradingMode(w, { id: "all-sbg", gradingMode: "percentage" }), "percentage");
  assert.equal(gradingModeName("sbg"), "Standards-Based (0–4)");
});

test("both 'create a class' forms ask, and save the choice", () => {
  for (const f of ["components/teacher-classes.tsx", "components/teacher-app.tsx"]) {
    const src = readFileSync(f, "utf8");
    assert.match(src, /<ClassGradingModeField value=\{mode\} onChange=\{setMode\} \/>/, f);
    assert.match(src, /gradingMode: mode/, f + ": saved on the new class");
  }
  // Editing a class shows its mode; it cannot be changed.
  const classes = readFileSync("components/teacher-classes.tsx", "utf8");
  assert.match(classes, /gradingModeName\(classGradingMode\(w, edit\)\)/);
  assert.match(classes, /Chosen when this class was created; it can&apos;t be changed\./);
});

test("test setup offers no choice: a new test takes its class's mode, and only same-mode classes can share it", () => {
  const src = readFileSync("components/teacher-scan.tsx", "utf8");
  assert.doesNotMatch(src, /GradingModeChoice/);
  assert.match(src, /const gradingMode: GradingMode = editing \? gradingModeOf\(editing\) : classGradingMode\(w, classroom\);/);
  assert.match(src, /\.filter\(\(c\) => c\.id !== classroom\.id && classGradingMode\(w, c\) === gradingMode\)/);
  assert.match(src, /so\{" "\}\s*\{otherModeClasses === 1 \? "it can't" : "they can't"\} share this test\./);
});

test("the save keeps a class's mode", () => {
  const route = readFileSync("app/api/workspace/route.ts", "utf8");
  const classes = route.slice(route.indexOf("classes: z"), route.indexOf("activeClassId: z"));
  assert.match(classes, /gradingMode: z\.enum\(\["percentage", "sbg"\]\)\.optional\(\),/);
});

test("the migration: a checked column, both functions patched exactly once, the same backfill rule", () => {
  const sql = readFileSync("supabase/migrations/20261027130000_class_grading_mode.sql", "utf8");
  assert.doesNotMatch(sql, /\bdrop\b/i);
  assert.match(sql, /add column if not exists grading_mode text\s+check \(grading_mode is null or grading_mode in \('percentage', 'sbg'\)\)/);
  assert.match(sql, /raise exception 'class grading_mode migration: % fragment found % times, expected 1: %'/);
  assert.match(sql, /'''demo'', is_demo, ''gradingMode'', grading_mode\)\)'/, "get_workspace_json returns it");
  assert.match(sql, /'is_demo = excluded\.is_demo, grading_mode = excluded\.grading_mode,'/, "sync_workspace updates it");
  assert.match(sql, /where c\.grading_mode is null;/, "the backfill never overwrites a class's choice");
  assert.match(sql, /a\.class_id = c\.id or c\.legacy_id = any\(a\.class_ids\)/, "tests shared into a class count");
  assert.match(sql, /a\.grading_mode is distinct from 'sbg'\)\s*then 'sbg' else 'percentage' end/);
  // No test's own mode is touched.
  assert.doesNotMatch(sql, /update public\.assessments/);
  const check = readFileSync("supabase/checks/class-grading-mode-round-trip.sql", "utf8");
  for (const k of ["unset=", "backfill_mismatch=", "c0=", "c1=", "c2=", "test_modes_unchanged="]) assert.ok(check.includes(k), k);
  assert.match(check, /raise exception 'ROLLED_BACK/);
});
