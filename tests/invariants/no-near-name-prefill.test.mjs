// RULE R3, gap G12: a child missing from the roster whose name is close to a
// rostered child's is never pre-filled as that child. docs/system-map.md.
//
// Verified 14 Oct 2026 (Troy): "Christina Lee" fits "Chris Lee" at 0.947,
// "Josefina Ruiz" fits "Jose Ruiz" at 0.940 and "Danielle Kim" fits "Daniel
// Kim" at 0.970 -- all above PREFILL_SCORE (0.9), so with a clear read the
// matching screen chose the rostered child for the teacher. A sibling or a new
// student not yet on the roster then had their grades saved under someone
// else unless the teacher noticed a name already filled in.
//
// The rule now: the app pre-fills only when the given name written on the page
// IS the roster's given name (case and accents aside) or a known short form of
// it ("Mike" for Michael). Everything else is a suggestion, one tap away.
import test from "node:test";
import assert from "node:assert/strict";
import { bundle } from "./lib/bundle.mjs";

const C = bundle("lib/teacher-class-scan.ts");

const student = (id, name) => ({ id, classId: "c", name, color: "#000", evidence: [], notes: "" });
const roster = [
  student("chris", "Chris Lee"),
  student("jose", "Jose Ruiz"),
  student("daniel", "Daniel Kim"),
  student("maria", "Maria Chen"),
  student("ana", "Ana Lee"),
  student("michael", "Michael Smith"),
  student("sofia", "Sofía Núñez"),
  student("james", "James Ortiz"),
];

/** The matching-screen row for one page with this name read clearly. */
const row = (written, confidence = 95) =>
  C.resolveScannedGroups([[0]], [{ page: 0, name: written, confidence }], [], ["page-0"], roster)[0];

test("near-names of a rostered child are never pre-filled -- they are suggestions", () => {
  for (const [written, lookalike] of [
    ["Christina Lee", "chris"],
    ["Josefina Ruiz", "jose"],
    ["Danielle Kim", "daniel"],
    ["Mia Chen", "maria"],
  ]) {
    const r = row(written);
    assert.equal(r.studentId, null, `${written} was pre-filled as ${r.studentId}`);
    assert.ok(r.candidateIds.includes(lookalike), `${written}: ${lookalike} is still offered as a suggestion`);
  }
});

test("a translation, a misspelling or a reversed name is a suggestion too, not a choice", () => {
  // Same family in the matcher's nickname table, but not a short form: a
  // Diego is not a James, and a Miguel is often not a Michael.
  for (const written of ["Diego Ortiz", "Miguel Smith", "Micheal Smith", "Lee Ana"]) {
    const r = row(written);
    assert.equal(r.studentId, null, `${written} was pre-filled as ${r.studentId}`);
    assert.ok(r.candidateIds.length > 0, `${written} still gets a suggestion`);
  }
});

test("exact and normal matches are still pre-filled", () => {
  for (const [written, id] of [
    ["Ana Lee", "ana"],
    ["ana lee", "ana"],
    ["ANA  LEE", "ana"],
    ["Sofia Nunez", "sofia"], // accents aside
    ["Maria C.", "maria"], // first name and the surname's initial
    ["Chris L", "chris"],
    ["Mike Smith", "michael"], // a known short form
    ["Jim Ortiz", "james"],
  ]) {
    const r = row(written);
    assert.equal(r.studentId, id, `${written} should pre-fill ${id}, got ${r.studentId}`);
  }
});

test("a shaky read is still never pre-filled, whatever the name", () => {
  assert.equal(row("Ana Lee", 50).studentId, null);
});

test("givenNameMayPrefill: same name or a known short form, either way round", () => {
  assert.equal(C.givenNameMayPrefill("Mike Smith", "Michael Smith"), true);
  assert.equal(C.givenNameMayPrefill("Michael Smith", "Mike Smith"), true);
  assert.equal(C.givenNameMayPrefill("CHRISTINA lee", "Chris Lee"), false);
  assert.equal(C.givenNameMayPrefill("Mia Chen", "Maria Chen"), false);
});
