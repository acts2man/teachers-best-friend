// RULE R3 (no wrong student) and "nothing a teacher scanned disappears", gap
// G1: pages that change between grading and the matching screen.
// docs/system-map.md.
//
// G1 was written up from reading the code (14 Oct). Reproduced here with the
// real lib functions, it splits three ways:
//   1. A NAME-split stack that gains a page before a resume: main re-planned
//      the groups from the piles on screen and laid the saved answers on them
//      by index -- another child's answers (same mechanism as G3; fixed by
//      #140's planResume, asserted again here).
//   2. Camera piles (the teacher's own "next student" boundaries) that gain a
//      page: group numbers follow the piles in order, so on main the saved
//      answers stayed with the right student. Harmless, but #140 now asks the
//      teacher anyway (the pages differ from what was graded).
//   3. Pages the OTHER device added while this one graded: the 409 retry in
//      use-scan-session applied them mid-run, the run graded its own copy, so
//      they had no row on the matching screen -- and saving the class cleared
//      every pile, so they were lost with no message. Same for the rest of a
//      run that stopped part-way ("confirm those, then press Done for the
//      rest"), and for rows saveAll skips (no answers, or a cleared name).
//      Fixed here: pages no SAVED row covers are kept for the next grading.
//      (A first version also held the 409 merge until the run ended; review
//      showed that could resurrect a just-saved class and drop the other
//      device's pages from the server, so it was taken out.)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bundle } from "./lib/bundle.mjs";

const C = bundle("lib/teacher-class-scan.ts");
const S = bundle("lib/scan-session.ts");

const page = (bodyId, extra = {}) => ({ key: bodyId, label: "Page", bodyId, stripId: null, pages: 1, ...extra });
const student = (id, name) => ({ id, classId: "c", name, color: "#000", evidence: [], notes: "" });
const roster = [student("ana", "Ana Torres"), student("ben", "Ben Okafor"), student("cy", "Cy Park")];
/** A matching-screen row: saved when it has answers and a name. */
const row = (key, pageUploadIds, extra = {}) => ({ key, pageUploadIds, name: "Student", responses: [{ questionId: "q1", answer: "1", verdict: "other" }], ...extra });

test("1. reproduced: a name-split stack that gains a page, resumed by main's rule, puts answers on the wrong child", () => {
  const names = [["Ana Torres", 99], ["", 0], ["Ben Okafor", 99], ["", 0], ["Cy Park", 99], ["", 0]].map(([name, confidence], p) => ({ page: p, name, confidence }));
  const ids = names.map((_, i) => "b" + i);
  const graded = [{ group: 0, responses: [{ questionId: "q1", answer: "Ana's answer", verdict: "other" }] }];
  // The teacher adds one page (a new pile) and grading resumes. Main graded
  // the piles on screen as declared: [stack of 6], [new page].
  const withNew = [...names, { page: 6, name: "Cy Park", confidence: 99 }];
  const oldGroups = C.groupPagesByCapture([6, 1]);
  const [first] = C.resolveScannedGroups(oldGroups, withNew, graded, [...ids, "b6"], roster);
  assert.deepEqual(first.responses.map((r) => r.answer), ["Ana's answer"]);
  assert.equal(first.pageIndexes.length, 6, "Ana's answers sit on a row holding all three children's pages");
  // With #140: the pages are not the ones the progress was graded against.
  const layout = C.groupPagesByName(names, (n) => C.rosterMatchCount(n, roster)).map((g) => g.map((p) => ids[p]));
  assert.equal(S.planResume({ graded, nextBatch: 1, scanId: null, layout }, [...ids, "b6"]).kind, "changed");
});

test("2. camera piles that gain a page keep each student's group number (harmless on main; #140 asks anyway)", () => {
  const before = C.groupPagesByCapture([2, 2, 1]);
  const after = C.groupPagesByCapture([2, 3, 1]); // the other device added a page to the second pile
  assert.equal(before.length, after.length);
  const ids = ["a0", "a1", "b0", "b1", "c0"];
  const idsAfter = ["a0", "a1", "b0", "b1", "b2", "c0"];
  for (let g = 0; g < before.length; g++) assert.equal(ids[before[g][0]], idsAfter[after[g][0]], `group ${g} is the same student`);
  const layout = before.map((g) => g.map((p) => ids[p]));
  assert.equal(S.planResume({ graded: [{ group: 0, responses: [] }], nextBatch: 1, scanId: null, layout }, idsAfter).kind, "changed");
});

test("3. pages the other device added mid-grade have no row -- and are kept, not cleared, on save", () => {
  // This device graded a, b; the other device's c arrived through the 409 merge.
  const local = { v: 1, piles: [[page("a")], [page("b")], []], progress: null, groups: null, discarded: [], pageUploadIds: [], grading: null };
  const server = { ...local, piles: [[page("a")], [page("b")], [page("c")], []] };
  const merged = S.mergeSessions(server, local);
  const rows = [row("group-0", ["a"]), row("group-1", ["b"])];
  assert.deepEqual(S.pagesWithoutRow(merged.piles, rows).flat().map((p) => p.bodyId), ["c"]);
});

test("pagesWithoutRow: the rest of a run that stopped part-way, piles kept, discarded rows covered", () => {
  const piles = [[page("a0"), page("a1")], [page("b0")], [page("c0"), page("c1", { stack: true })], []];
  const rows = [row("g0", ["a0", "a1"]), row("g1", ["b0"])];
  const left = S.pagesWithoutRow(piles, rows, new Set(["g1"])); // b0's row discarded: still covered
  assert.deepEqual(left.map((p) => p.map((x) => x.bodyId)), [["c0", "c1"]], "c's pile, as one pile");
  assert.equal(left[0][1].stack, true, "page flags carry over");
  assert.deepEqual(S.pagesWithoutRow(piles, null), [], "no rows on screen: nothing to keep");
  assert.deepEqual(S.pagesWithoutRow(piles, [row("g", ["a0", "a1", "b0", "c0", "c1"])]), []);
});

test("rows the save skips -- no answers, or a cleared name -- leave their pages kept, not lost (#144 review)", () => {
  const piles = [[page("a")], [page("b")], [page("c")]];
  const rows = [row("g0", ["a"]), row("g1", ["b"], { responses: [] }), row("g2", ["c"], { name: "  " })];
  assert.deepEqual(S.pagesWithoutRow(piles, rows).flat().map((p) => p.bodyId), ["b", "c"]);
  // ...unless the teacher discarded that row on purpose.
  assert.deepEqual(S.pagesWithoutRow(piles, rows, new Set(["g1", "g2"])), []);
});

test("the save keeps pages no saved row covers, and the note counts the same pages", () => {
  const panel = readFileSync("components/teacher-class-scan.tsx", "utf8").replace(/\/\/.*$/gm, "");
  const save = panel.slice(panel.indexOf("async function saveAll("));
  const ok = save.slice(save.indexOf("if (ok) {"), save.indexOf("requestAnimationFrame"));
  assert.match(ok, /const left = pagesWithoutRow\(piles, groups, discarded\);\s*if \(left\.length\) keepForNextGrading\(left\);\s*else reset\(\);/);
  assert.match(panel, /const notGraded = pagesWithoutRow\(piles, groups, discarded\)/, "the note counts what the save keeps");
});
