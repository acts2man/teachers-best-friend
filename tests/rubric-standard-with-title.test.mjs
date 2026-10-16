// The writing-rubric read had the same bug #158 fixed for assignment reads:
// the AI writes a trait's standard as code plus title ("W.4.1 — Write opinion
// pieces on topics or texts"). The rubric read kept a standard only when it
// equalled a catalog code exactly, so a titled code was silently blanked --
// and its schema capped the standard at 40 characters, so a long title failed
// the WHOLE rubric read with "The rubric couldn't be read reliably." (422).
//
// Now a trait's standard goes through the same matchCatalogCode as an
// assignment's: the code part matches, the result is a catalog code or
// nothing, and a title never matches on its own or fails the read.
// Public standard codes and titles only; no student data (rule R8).
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

const catalog = ["W.4.1", "W.4.2", "W.4.4", "L.4.2"].map((code) => ({
  code, title: "t", subject: "ELA", grade: 4, framework: "Common Core", domain: "", cluster: "", wording: "w",
}));
const w = { assessments: [], students: [], classes: [], lessons: [] };
const p = { mode: "rubric", grade: 4, subject: "ELA", framework: "Common Core", text: "" };
const read = (standards) =>
  finalizeAnalysis(p, { traits: standards.map((standard, i) => ({ name: "Trait " + (i + 1), max: 4, descriptor: "d", standard })) }, w, catalog);

test("a titled standard code longer than 40 characters reads, and matches by its code", () => {
  const long = "W.4.1 — Write opinion pieces on topics or texts, supporting a point of view with reasons";
  assert.ok(long.length > 40);
  let out;
  assert.doesNotThrow(() => (out = read([long])), "a long title must never fail the whole rubric read");
  assert.equal(out.traits[0].standard, "W.4.1");
});

test("a short titled code matches by its code instead of being blanked", () => {
  const out = read(["W.4.2 — Informative writing", "L.4.2: Conventions", "W.4.4 (Production and distribution)"]);
  assert.deepEqual(out.traits.map((t) => t.standard), ["W.4.2", "L.4.2", "W.4.4"]);
});

test("still a catalog code or nothing: no title matches on its own", () => {
  const out = read([
    "W.4.9 — Write opinion pieces", // a code not in the catalog
    "Write opinion pieces on topics or texts", // a title alone
    "Opinion writing — W.4.1", // the title first
    "",
  ]);
  assert.deepEqual(out.traits.map((t) => t.standard), ["", "", "", ""]);
});

test("a bare catalog code and the matcher's known spellings still match", () => {
  const out = read(["W.4.1", "CCSS.ELA-LITERACY.W.4.2", "W.4.1a"]);
  // A sub-part the catalog does not list rolls up to its standard, as in the
  // assignment read; the ELA catalogs list parent standards only.
  assert.deepEqual(out.traits.map((t) => t.standard), ["W.4.1", "W.4.2", "W.4.1"]);
});

test("the rubric prompt asks for the code only", () => {
  const { task } = buildPrompt(p, w, catalog, true);
  assert.match(task, /the code only/i);
});
