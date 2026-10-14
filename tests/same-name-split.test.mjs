// #125 follow-up a (13 Oct): two consecutive pages reading the same first name,
// with no roster or surname to tell them apart, are kept as one student -- and
// the matching screen offers a one-tap "These are 2 different students" split.
// This is where it is offered. Names are placeholders.
import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const r = buildSync({ entryPoints: ["lib/teacher-class-scan.ts"], bundle: true, platform: "node", format: "cjs", write: false });
const m = { exports: {} };
new Function("module", "exports", r.outputFiles[0].text)(m, m.exports);
const { groupPagesByName, sameFirstNameSplit } = m.exports;
const pages = (...names) => names.map((name, page) => (name === null ? { page, name: "", confidence: 0, failed: true } : { page, name, confidence: 95 }));

test("two pages reading the same first name, no roster: one student, with the split offered at the second", () => {
  const names = pages("Maria", "Maria");
  const groups = groupPagesByName(names);
  assert.deepEqual(groups, [[0, 1]], "kept together, as before");
  assert.equal(sameFirstNameSplit(groups[0], names), 1);
});

test("offered at the second reading, skipping pages with no name (two Marias with a two-page test each)", () => {
  // Review: [Maria, "", Maria, ""] -- the name on page 1 only -- is the common
  // multi-page case; the split goes at the second Maria's first page.
  const names = pages("Ana", "", "Maria", "", "Maria", "");
  const groups = groupPagesByName(names);
  assert.deepEqual(groups, [[0, 1], [2, 3, 4, 5]]);
  assert.equal(sameFirstNameSplit(groups[0], names), -1);
  assert.equal(sameFirstNameSplit(groups[1], names), 2, "split before page 4");
  const tight = pages("Maria", "Maria", "");
  assert.equal(sameFirstNameSplit(groupPagesByName(tight)[0], tight), 1);
  // A failed read between them breaks the run: unknown is not "no name".
  assert.equal(sameFirstNameSplit([0, 1, 2], pages("Maria", null, "Maria")), -1);
});

test("not offered for a full name, different names, or a failed read", () => {
  assert.equal(sameFirstNameSplit([0, 1], pages("Maria Lopez", "Maria Lopez")), -1);
  assert.equal(sameFirstNameSplit([0, 1], pages("Maria", "Mario")), -1);
  assert.equal(sameFirstNameSplit([0, 1], pages("Maria", null)), -1);
  assert.equal(sameFirstNameSplit([0], pages("Maria")), -1);
  assert.equal(sameFirstNameSplit([0, 1], pages(" maria ", "MARIA")), 1, "case and spaces");
});
