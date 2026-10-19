// The standards-list read (catalog mode) had the pattern #158 and #160 fixed in
// the assignment and rubric reads: each code was capped at 40 characters, so
// one code the AI wrote with its title failed the WHOLE list ("The standards
// list needs review", 422), and a shorter titled code was stored as the code.
//
// Now each code goes through matchCatalogCode (a code the class's catalog
// already has keeps its exact spelling) or codeParts (the code before the
// title), and only a code is stored: an entry with no code in it is dropped,
// never the list. Public standard codes and titles only.
import test from "node:test";
import assert from "node:assert/strict";
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
const { finalizeAnalysis, buildPrompt } = bundle("lib/analyze-shared.ts");

const w = { assessments: [], students: [], classes: [], lessons: [], customStandards: [], sharedStandards: [] };
const item = (code) => ({ code, title: "t", domain: "d", cluster: "c", wording: "w", skills: [], dok: 2, misconception: "m", example: "e" });
const read = (codes, framework = "Common Core", catalog = []) =>
  finalizeAnalysis({ mode: "catalog", grade: 9, subject: "Math", framework, text: "" }, { standards: codes.map(item) }, w, catalog);

test("a titled code longer than 40 characters never fails the list, and is stored as its code", () => {
  const long = "F-IF.7 — Graph functions expressed symbolically and show key features of the graph";
  assert.ok(long.length > 40);
  let out;
  assert.doesNotThrow(() => (out = read([long, "F-BF.3"])));
  assert.deepEqual(out.standards.map((s) => s.code), ["F-IF.7", "F-BF.3"]);
});

test("a code the class's catalog already has keeps the catalog's exact spelling", () => {
  const out = read(["HSF-IF.C.7 — Graph functions"], "Common Core", [{ code: "F-IF.7" }]);
  assert.deepEqual(out.standards.map((s) => s.code), ["F-IF.7"]);
});

test("a state code with no catalog yet: the code before the title, the longest code-shaped one", () => {
  const out = read(["MA.4.NSO.1.1 — Express how the value of a digit changes", "4.4 (D) — Compute products", "111.26(b)(4)(A): Solve problems"], "Florida");
  assert.deepEqual(out.standards.map((s) => s.code), ["MA.4.NSO.1.1", "4.4 (D)", "111.26(b)(4)(A)"]);
});

test("only a real code is stored: an entry with no code is dropped, the list is not", () => {
  const out = read(["Graph functions and key features", "Graph functions — F-IF.7", "F-IF.4"]);
  assert.deepEqual(out.standards.map((s) => s.code), ["F-IF.4"]);
});

test("a sub-part the catalog lacks stays its own standard, not its parent", () => {
  const out = read(["F-IF.7 — Graph functions", "F-IF.7e — Graph trigonometric functions"], "Common Core", [{ code: "F-IF.7" }]);
  assert.deepEqual(out.standards.map((s) => s.code), ["F-IF.7", "F-IF.7e"]);
});

test("the same code twice, once with a title, is one standard", () => {
  const out = read(["F-IF.7", "F-IF.7 — Graph functions"]);
  assert.deepEqual(out.standards.map((s) => s.code), ["F-IF.7"]);
});

test("the standards-list prompt asks for the code only", () => {
  const { task } = buildPrompt({ mode: "catalog", grade: 4, subject: "Math", framework: "Common Core", text: "" }, w, [], false);
  assert.match(task, /the code only/i);
});
