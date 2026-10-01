// PR4: a third writing genre, Response writing (constructed response / RACES),
// with its own 5-row 4-point rubric; plus the genre cards laid out as proper
// radio cards (radio inline-left, not a full-width box above the text).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);
function bundle(entry) {
  const r = buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    absWorkingDir: ROOT,
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

const { defaultRubric, WRITING_GENRES, genreLabel } = bundle("lib/writing-rubrics.ts");

// ---------------------------------------------------------------
// The genre and its rubric
// ---------------------------------------------------------------

test("Response writing is offered as a genre", () => {
  const values = WRITING_GENRES.map((g) => g.value);
  assert.deepEqual(values, ["informational", "narrative", "response"]);
  assert.equal(genreLabel("response"), "Response writing");
});

test("the response rubric has the five named rows, all on a 4-point scale", () => {
  const rows = defaultRubric("response", 5);
  assert.deepEqual(
    rows.map((r) => r.name),
    ["Answer", "Cite Evidence", "Explain", "Organization", "Conventions"],
  );
  for (const r of rows) assert.equal(r.max, 4, r.name + " is 4 points");
  // Each row carries a non-empty descriptor and a standard the teacher can edit.
  for (const r of rows) {
    assert.ok(r.descriptor.trim().length > 0, r.name + " has a descriptor");
    assert.ok(r.standard.trim().length > 0, r.name + " has a standard");
    assert.ok(r.id, r.name + " has an id");
  }
});

test("the response levels are named 4 Excellent down to 1 Beginning", () => {
  const rows = defaultRubric("response", 4);
  assert.match(rows[0].descriptor, /4 Excellent, 3 Proficient, 2 Developing, 1 Beginning/);
});

test("the row descriptors carry Michael's wording", () => {
  const byName = Object.fromEntries(defaultRubric("response", 6).map((r) => [r.name, r.descriptor]));
  assert.match(byName["Answer"], /answers all parts of the question/i);
  assert.match(byName["Cite Evidence"], /text evidence/i);
  assert.match(byName["Explain"], /explains how the evidence supports/i);
  assert.match(byName["Organization"], /complete sentences/i);
  assert.match(byName["Conventions"], /capitalization, punctuation, spelling/i);
});

test("the two SBAC genres are unchanged (three traits each)", () => {
  assert.equal(defaultRubric("informational", 5).length, 3);
  assert.equal(defaultRubric("narrative", 5).length, 3);
});

// ---------------------------------------------------------------
// Genre card layout: radio inline-left, not a box above
// ---------------------------------------------------------------

test("the genre cards are a left-radio row, not a stacked box", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const rule = /\.genre-option \{[^}]*\}/.exec(css)[0];
  assert.match(rule, /flex-direction:row/);
  // The native radio is reset off the global full-width input box styling.
  const radio = /\.genre-option>input\[type=radio\] \{[^}]*\}/.exec(css)[0];
  assert.match(radio, /width:auto/);
  assert.match(radio, /appearance:auto/);
});

test("the genre label carries the genre-option class", () => {
  const scan = readFileSync("components/teacher-scan.tsx", "utf8");
  assert.match(scan, /"target-standard-option genre-option "/);
});

// ---------------------------------------------------------------
// Genre persists (existing field; guard covers the mapping)
// ---------------------------------------------------------------

test("genre stays in the workspace-persistence allowlist", () => {
  const guard = readFileSync("tests/workspace-persistence-guard.test.mjs", "utf8");
  assert.match(guard, /"passage", "genre", "rubric"/);
});
