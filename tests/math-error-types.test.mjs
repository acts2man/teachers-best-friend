// Ricky's new Math error list (Slack, 24 Oct 2026). Proven when: Math (and
// Mixed) offer exactly his eight, in his order; "Other" takes the teacher's
// own label, stored as "Other: <label>", shown to the teacher and counted in
// the panels, while the AI only ever sees "Other" -- never the words; the
// grading AI is never asked to suggest "Other"; and the migration copies
// every old tag to its legacy column before clearing it, with a rolled-back
// check that runs the migration's own statements.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
function bundle(entry) {
  const r = buildSync({
    entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, absWorkingDir: ROOT,
    alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}
const E = bundle("lib/error-types.ts");
const { dokCellDetail, lessonFocus } = bundle("lib/teacher-class-analysis.ts");
const { gradingExtras, readGradedExtras } = bundle("lib/analyze-shared.ts");

const RICKY = [
  "Conceptual Gap", "Setup/Method Error", "Algebraic/Procedural Error", "Sign Error",
  "Graphing Error", "Data Interpretation Error", "Reasoning/Justification Error", "Other",
];
const OLD = ["Algebraic/Arithmetic error", "Sign error", "Conceptual/Setup error", "Wrong formula", "Graph/Table interpretation error"];

test("Math and Mixed offer Ricky's eight, in his order; none of the old five", () => {
  assert.deepEqual(E.errorTypesFor("Math"), RICKY);
  assert.deepEqual(E.errorTypesFor("Mixed"), RICKY);
  for (const old of OLD) assert.ok(!E.ALL_ERROR_TYPES.includes(old), old);
});

test("Other takes the teacher's own label: trimmed, one line, short; empty is plain Other", () => {
  assert.equal(E.otherErrorLabel("  forgot   to\ndistribute "), "Other: forgot to distribute");
  assert.equal(E.otherErrorLabel("   "), "Other");
  assert.equal(E.otherErrorLabel("x".repeat(200)).length, "Other: ".length + E.OTHER_LABEL_MAX);
  assert.equal(E.otherErrorText("Other: forgot units"), "forgot units");
  assert.ok(E.isOtherErrorType("Other") && E.isOtherErrorType("Other: forgot units"));
  assert.ok(E.onErrorList(RICKY, "Other: forgot units"), "a typed label belongs to a list with Other");
  assert.ok(!E.onErrorList(E.errorTypesFor("ELA", "reading"), "Other: forgot units"), "not to one without");
  assert.ok(!E.onErrorList(RICKY, "Sign error"), "an old tag is not on the new list");
});

test("the grading AI is never asked to suggest Other, and a suggestion of it (or an old name) is dropped", () => {
  const prompt = gradingExtras("Math");
  for (const t of RICKY.slice(0, 7)) assert.ok(prompt.includes(JSON.stringify(t)), t);
  assert.ok(!prompt.includes('"Other"'));
  assert.equal(readGradedExtras({ errorType: "Other" }, [], "Math").suggestedErrorType, undefined);
  assert.equal(readGradedExtras({ errorType: "Sign error" }, [], "Math").suggestedErrorType, undefined);
  assert.equal(readGradedExtras({ errorType: "Sign Error" }, [], "Math").suggestedErrorType, "Sign Error");
});

const q = (id, dok) => ({ id, number: 1, text: "", answer: "", standard: "A.1", dok, verified: true, excluded: false });
const r = (studentId, questionId, errorType) => ({ id: studentId + questionId, studentId, questionId, answer: "7", correct: false, match: 0, confidence: 90, verified: true, errorType });
const math = {
  id: "a1", subject: "Math", questions: [q("q1", 2)],
  responses: [
    r("s1", "q1", "Other: forgot to distribute"),
    r("s2", "q1", "Other: forgot to distribute"),
    r("s3", "q1", "Other: mixed up the axes"),
    r("s4", "q1", "Sign Error"),
    r("s5", "q1", "Sign error"), // an old tag a stale tab wrote back: not on the list
  ],
};
const students = ["s1", "s2", "s3", "s4", "s5"].map((id) => ({ id, name: "Student " + id }));

test("the teacher sees their own labels in the cell panel", () => {
  const { errorTypes } = dokCellDetail(math, students, ["q1"]);
  assert.deepEqual(errorTypes.map((t) => [t.errorType, t.count]), [
    ["Other: forgot to distribute", 2],
    ["Other: mixed up the axes", 1],
    ["Sign Error", 1],
  ]);
});

test("what reaches the AI is 'Other' with a count -- never the teacher's words", () => {
  const focus = lessonFocus(math, "A.1", [2]);
  assert.deepEqual(focus.errorTypes, [{ name: "Other", count: 3 }, { name: "Sign Error", count: 1 }]);
  assert.doesNotMatch(JSON.stringify(focus), /distribute|axes/);
  for (const e of focus.errorTypes) assert.ok(E.ALL_ERROR_TYPES.includes(e.name), e.name);
});

test("the grading screen's pickers both take a typed Other label", () => {
  const review = readFileSync("components/teacher-review.tsx", "utf8");
  assert.equal((review.match(/<ErrorTypePick /g) ?? []).length, 2);
  assert.match(review, /<ErrorTypePick types=\{types\} value=\{tagged\} onChange=\{onTag\} disabled=\{busy\} \/>/);
  assert.match(review, /<ErrorTypePick types=\{types\} value=\{errorType\} onChange=\{setErrorType\} live \/>/);
  assert.match(review, /const suggested = g\.suggestedErrorType && types\.includes\(g\.suggestedErrorType\) \? g\.suggestedErrorType : "";/, "an old suggestion is not offered");
  assert.match(review, /maxLength=\{OTHER_LABEL_MAX\}/);
});

const MIGRATION = "supabase/migrations/20261027120000_math_error_types_v2.sql";
const CHECK = "supabase/checks/math-error-types-v2.sql";

test("the migration moves exactly the old five, copy first, Math and Mixed only, and never drops", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  assert.doesNotMatch(sql, /\bdrop\b/i);
  assert.match(sql, /add column if not exists legacy_error_type text,\s*add column if not exists legacy_suggested_error_type text;/);
  const list = sql.slice(sql.indexOf("with old(name) as ("), sql.indexOf("), moved as ("));
  assert.deepEqual([...list.matchAll(/\('([^']+)'\)/g)].map((m) => m[1]), OLD);
  assert.match(sql, /legacy_error_type = case when r\.error_type in \(select name from old\)\s*then r\.error_type else r\.legacy_error_type end/);
  assert.match(sql, /error_type = case when r\.error_type in \(select name from old\) then null else r\.error_type end/);
  assert.match(sql, /and a\.subject in \('Math', 'Mixed'\)/);
  assert.match(sql, /update public\.teacher_workspaces w set revision = w\.revision \+ 1/, "a stale tab cannot write old tags back");
  // No grade column is written.
  assert.doesNotMatch(sql, /\b(correct|match_score|verified|confidence|answer)\s*=/);
});

test("the check runs the migration's own statements, verbatim, and rolls back", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  const check = readFileSync(CHECK, "utf8");
  const body = sql.slice(sql.indexOf("with old(name) as ("));
  const copied = check.slice(check.indexOf("-- ---- 20261027120000"), check.indexOf("-- ---- to here ----"));
  assert.ok(copied.includes(body.trim()), "the update is copied verbatim");
  assert.match(copied, /add column if not exists legacy_error_type text,\s*add column if not exists legacy_suggested_error_type text;/);
  assert.match(check, /raise exception 'ROLLED_BACK/);
  for (const k of ["grades_changed", "legacy_mismatch", "not_cleared", "others_changed", "other_round_trip", "legacy_kept_on_save"])
    assert.ok(check.includes(k + "="), k);
});
