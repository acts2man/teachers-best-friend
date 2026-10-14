// Gap G12 (docs/system-map.md): a child whose name is a longer or shorter
// given name than a rostered child's -- Christina against "Chris Lee",
// Josefina against "Jose Ruiz", Danielle against "Daniel Kim" -- was PRE-FILLED
// as that child. The fuzzy matcher scored them 0.947, 0.940 and 0.970, above
// the 0.9 pre-fill line, so a sibling, a new student or a twin missing from
// the roster had their grades put on another child unless the teacher noticed.
//
// They are different given names, not misspellings: one is the other with
// letters added. Now such a fit is only ever a SUGGESTION (one tap), never a
// choice made for the teacher. Real misspellings still pre-fill.
//
// Made-up names only (rule R8).
import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

function bundle(path) {
  const r = buildSync({ entryPoints: [path], bundle: true, platform: "node", format: "cjs", write: false });
  const m = { exports: {} };
  new Function("module", "exports", r.outputFiles[0].text)(m, m.exports);
  return m.exports;
}
const { resolveScannedGroups } = bundle("lib/teacher-class-scan.ts");

const student = (name, i) => ({ id: "s" + i, classId: "c1", name, color: "#000", evidence: [], notes: "" });
const roster = ["Chris Lee", "Jose Ruiz", "Daniel Kim", "Michael Smith", "Ana Gonzalez", "Sam Patel"].map(student);
const idOf = (name) => roster.find((s) => s.name === name).id;

/** The matching screen's row for one page whose name was read clearly. */
function rowFor(read) {
  const [row] = resolveScannedGroups([[0]], [{ page: 0, name: read, confidence: 99 }], [], ["p0"], roster);
  return row;
}

test("G12: a different given name that extends a rostered one is never pre-filled", () => {
  for (const [read, rostered] of [
    ["Christina Lee", "Chris Lee"],
    ["Josefina Ruiz", "Jose Ruiz"],
    ["Danielle Kim", "Daniel Kim"],
  ]) {
    const row = rowFor(read);
    assert.equal(row.studentId, null, `${read} must not be put on ${rostered}`);
    assert.deepEqual(row.candidateIds, [idOf(rostered)], `${rostered} is offered as a one-tap suggestion`);
  }
});

test("the other direction too: a shorter given name is a suggestion, not a choice", () => {
  for (const [read, rostered] of [
    ["Dan Kim", "Daniel Kim"],
    ["Christopher Lee", "Chris Lee"],
    ["Samantha Patel", "Sam Patel"],
  ]) {
    const row = rowFor(read);
    assert.equal(row.studentId, null, read);
    assert.deepEqual(row.candidateIds, [idOf(rostered)], read);
  }
});

test("a real misspelling of a rostered name still pre-fills", () => {
  assert.equal(rowFor("Micheal Smith").studentId, idOf("Michael Smith"));
  assert.equal(rowFor("Ana Gonzales").studentId, idOf("Ana Gonzalez"));
});

test("exact names and surname fits still pre-fill", () => {
  assert.equal(rowFor("Chris Lee").studentId, idOf("Chris Lee"));
  assert.equal(rowFor("Jose R.").studentId, idOf("Jose Ruiz"));
});
