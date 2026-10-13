// PR 2 review (#125, blocker 1a and 1b): grouping a stack by the names read off
// each page, when the teacher did not declare piles.
//
// The rule this replaced treated any name that came back after a different name
// as "not a student" (to catch a printed motto read as a name). It merged real
// students: fronts-then-backs collapsed six students' pages into one group, a
// re-scanned student's pages went under the student before them, and a second
// student sharing a first name joined the student in between. A failed name read
// was just as bad: it came back as "no name", so the page joined the previous
// student.
//
// The rule now: a page never joins another student's group on a guess. Every
// case below says which student each page really belongs to, and the test fails
// if any group holds pages of two different students. Names are placeholders.
import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

function bundle(path) {
  const r = buildSync({ entryPoints: [path], bundle: true, platform: "node", format: "cjs", write: false });
  const m = { exports: {} };
  new Function("module", "exports", r.outputFiles[0].text)(m, m.exports);
  return m.exports;
}
const { groupPagesByName, matchRosterStudent, mergeNameReads, mapLimit } = bundle("lib/teacher-class-scan.ts");

const roster = ["Avery Quinn", "Blake Rivera", "Casey Morgan", "Zed Ortiz", "Ana Silva", "Ben Okafor", "John Park", "Maria Lopez", "Maria Chen"].map(
  (name, i) => ({ id: "s" + i, classId: "c", name, color: "#000", evidence: [], notes: "" }),
);
const onRoster = (name) => {
  const m = matchRosterStudent(name, roster);
  return !!(m.student || m.candidates?.length);
};

/** names: what the name pass read on each page ("" = nothing, null = the read
 * FAILED). owners: whose page it really is. */
function run(names, owners, opts = {}) {
  const pages = names.map((name, page) =>
    name === null ? { page, name: "", confidence: 0, failed: true } : { page, name, confidence: name ? 95 : 0 },
  );
  const groups = groupPagesByName(pages, opts.noRoster ? undefined : onRoster);
  const mixed = groups.filter((g) => new Set(g.map((p) => owners[p])).size > 1);
  return { groups, mixed };
}
const noMixing = (r, label) => assert.deepEqual(r.mixed, [], label + ": a group holds two students' pages: " + JSON.stringify(r.groups));

test("1. fronts then backs (A,B,C,A,B,C): no student's page lands under another", () => {
  const r = run(["Avery", "Blake", "Casey", "Avery", "Blake", "Casey"], ["A", "B", "C", "A", "B", "C"]);
  noMixing(r, "fronts/backs");
  assert.equal(r.groups.length, 6);
});

test("2. a student re-scanned at the end (Zed,_,Ana,_,Ben,_,Ana)", () => {
  const r = run(["Zed", "", "Ana", "", "Ben", "", "Ana"], ["Z", "Z", "A", "A", "B", "B", "A"]);
  noMixing(r, "re-scan");
  assert.deepEqual(r.groups, [[0, 1], [2, 3], [4, 5], [6]]);
});

test("3. two students with the same first name (Maria,_,John,_,Maria,_)", () => {
  const r = run(["Maria", "", "John", "", "Maria", ""], ["M1", "M1", "J", "J", "M2", "M2"]);
  noMixing(r, "namesakes");
  assert.deepEqual(r.groups, [[0, 1], [2, 3], [4, 5]]);
});

test("4. a printed motto read as a name (Ana, Hope Always, Ben, Hope Always) stays with the student before it", () => {
  const r = run(["Ana", "Hope Always", "Ben", "Hope Always"], ["A", "A", "B", "B"]);
  assert.deepEqual(r.groups, [[0, 1], [2, 3]]);
});

test("5. a name on every page (Ana, Ana, Ben, Ben) is two students", () => {
  const r = run(["Ana", "Ana", "Ben", "Ben"], ["A", "A", "B", "B"]);
  assert.deepEqual(r.groups, [[0, 1], [2, 3]]);
});

test("a name not on the roster that cycles like fronts/backs (Avery, Newkid, Avery, Newkid) is NOT taken for a motto", () => {
  const r = run(["Avery", "Newkid", "Avery", "Newkid"], ["A", "N", "A", "N"]);
  noMixing(r, "unrostered student");
});

test("without a roster to check against, a motto is left as its own group for the teacher, never put under a student", () => {
  const r = run(["Ana", "Hope Always", "Ben", "Hope Always"], ["A", "M", "B", "M"], { noRoster: true });
  noMixing(r, "no roster");
});

test("1b. a FAILED name read never attaches the page to the previous student: it starts its own unnamed group", () => {
  // Ben's first page: the read failed (rate limit, timeout). His second page
  // has no name line. Before: both went under Ana.
  const r = run(["Ana", "", null, "", "Casey"], ["A", "A", "B", "B", "C"]);
  noMixing(r, "failed read");
  assert.deepEqual(r.groups, [[0, 1], [2, 3], [4]]);
});

test("1b. the failure is carried from the request to the page: mapLimit's fallback marks every page of a failed request", async () => {
  const slices = [[{ id: "n0", page: 0 }], [{ id: "n1", page: 1 }], [{ id: "n2", page: 2 }]];
  const reads = await mapLimit(slices, 2, async (slice) => {
    if (slice[0].page === 1) throw new Error("429");
    return { pages: [{ page: 0, name: slice[0].page === 0 ? "Ana" : "Ben", confidence: 95 }] };
  }, () => ({ failed: true }));
  const names = mergeNameReads(3, slices, reads);
  assert.equal(names[1].failed, true);
  assert.equal(names[0].failed, undefined);
  assert.deepEqual(groupPagesByName(names, onRoster), [[0], [1], [2]]);
});
