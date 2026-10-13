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
const { groupPagesByName, rosterMatchCount, mergeNameReads, mapLimit } = bundle("lib/teacher-class-scan.ts");

const roster = ["Avery Quinn", "Blake Rivera", "Casey Morgan", "Zed Ortiz", "Ana Silva", "Ben Okafor", "John Park", "Maria Lopez", "Maria Chen"].map(
  (name, i) => ({ id: "s" + i, classId: "c", name, color: "#000", evidence: [], notes: "" }),
);
const onRoster = (name) => rosterMatchCount(name, roster);

/** names: what the name pass read on each page ("" = nothing, null = the read
 * FAILED). owners: whose page it really is. */
function run(names, owners, opts = {}) {
  const pages = names.map((name, page) =>
    name === null ? { page, name: "", confidence: 0, failed: true } : { page, name, confidence: name ? 95 : 0 },
  );
  const groups = groupPagesByName(pages, opts.noRoster ? undefined : opts.roster ? (n) => rosterMatchCount(n, opts.roster) : onRoster);
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

test("4. a printed motto on a real class set stays with each student before it", () => {
  const r = run(["Ana", "Hope Always", "Ben", "Hope Always", "Casey", "Hope Always"], ["A", "A", "B", "B", "C", "C"]);
  assert.deepEqual(r.groups, [[0, 1], [2, 3], [4, 5]]);
});

test("4, as written (two students): the motto pages are left for the teacher, never put under another child", () => {
  // Trade-off (#125 review, round 3): with only two appearances this is
  // indistinguishable from a student missing from the roster scanned twice
  // (Zed, Ana, Ben, Ana), so neither is guessed.
  const r = run(["Ana", "Hope Always", "Ben", "Hope Always"], ["A", "M", "B", "M"]);
  noMixing(r, "two-student motto");
  assert.deepEqual(r.groups, [[0], [1], [2], [3]]);
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

// ---- #125 round-2 review -------------------------------------------------

test("re-scan of a student NOT on the roster (Zed,_,Ana,_,Ben,_,Ana) is not taken for a motto", () => {
  const partial = roster.filter((s) => !s.name.startsWith("Ana"));
  const r = run(["Zed", "", "Ana", "", "Ben", "", "Ana"], ["Z", "Z", "A", "A", "B", "B", "A"], { roster: partial });
  noMixing(r, "unrostered re-scan");
  const empty = run(["Zed", "", "Ana", "", "Ben", "", "Ana"], ["Z", "Z", "A", "A", "B", "B", "A"], { roster: [] });
  noMixing(empty, "empty roster");
});

test("an empty roster takes nothing for a motto (Ann, Bob, Cy, Bob)", () => {
  const r = run(["Ann", "Bob", "Cy", "Bob"], ["A", "B", "C", "B"], { roster: [] });
  noMixing(r, "empty roster");
});

test("a one-page re-scan of a student not on the roster (Zed, Ana, Ben, Ana) is not taken for a motto", () => {
  const partial = roster.filter((s) => !s.name.startsWith("Ana"));
  noMixing(run(["Zed", "Ana", "Ben", "Ana"], ["Z", "A", "B", "A"], { roster: partial }), "one-page re-scan, partial roster");
  noMixing(run(["Zed", "", "Ana", "Ben", "", "Ana"], ["Z", "Z", "A", "B", "B", "A"], { roster: partial }), "mixed lengths");
  noMixing(run(["Zed", "Ana", "Ben", "Ana"], ["Z", "A", "B", "A"], { roster: [] }), "empty roster");
});

test("a page with no name area to read (a PDF page) is unread, not joined to the student before it", () => {
  const slices = [[{ id: "n0", page: 0 }], [{ id: "n2", page: 2 }]];
  const names = mergeNameReads(3, slices, [{ pages: [{ page: 0, name: "Ana", confidence: 95 }] }, { pages: [{ page: 0, name: "Ben", confidence: 95 }] }]);
  assert.equal(names[1].failed, true);
  assert.deepEqual(groupPagesByName(names, onRoster), [[0], [1], [2]]);
});

test("split groups reading the same value two ways ('4' and '4.0') are not sent to Unsure", () => {
  const { mergeSplitGroups } = bundle("lib/teacher-class-scan.ts");
  const r = (answer, correct) => ({ id: answer, studentId: "s", questionId: "q", answer, finalAnswer: answer, correct, match: correct ? 100 : undefined, confidence: 100, verified: false, misconception: "" });
  const [m] = mergeSplitGroups([r("4", true)], [r("4.0", true)]);
  assert.equal(m.confidence, 100);
  assert.equal(m.correct, true);
});

test("two students sharing a first name, scanned one after the other (Maria,_,Maria,_), are not merged", () => {
  const r = run(["Maria", "", "Maria", ""], ["M1", "M1", "M2", "M2"]);
  noMixing(r, "adjacent namesakes");
  assert.deepEqual(r.groups, [[0, 1], [2, 3]]);
});

test("a page the model SKIPPED is unread, not blank: it is never joined to the student before it", () => {
  const slices = [[{ id: "n0", page: 0 }, { id: "n1", page: 1 }, { id: "n2", page: 2 }]];
  // The server marks a page it had to fill in as skipped.
  const names = mergeNameReads(3, slices, [{ pages: [
    { page: 0, name: "Ana", confidence: 95 },
    { page: 1, name: "", confidence: 0, skipped: true },
    { page: 2, name: "Ben", confidence: 95 },
  ] }]);
  assert.equal(names[1].failed, true);
  assert.deepEqual(groupPagesByName(names, onRoster), [[0], [1], [2]]);
  // And a page left out of the answer entirely, client side, the same.
  const missing = mergeNameReads(3, slices, [{ pages: [{ page: 0, name: "Ana", confidence: 95 }, { page: 2, name: "Ben", confidence: 95 }] }]);
  assert.equal(missing[1].failed, true);
});

test("B1. two groups of one scan matched to the same student keep BOTH groups' answers", () => {
  const { applyScannedGroups } = bundle("lib/teacher-class-scan.ts");
  const a = {
    id: "a", classId: "c", title: "t", subject: "Math", grade: 7, framework: "California", createdAt: "", status: "Ready", source: "ai",
    targetStandards: [], answerKeyVerified: true, uploadIds: [], responses: [],
    questions: [
      { id: "q1", number: 1, text: "", passage: "", answer: "4", standard: "", secondary: "", skill: "", dok: 1, alignment: 0, confidence: 0, level: "On grade", reasoning: "", verified: true, excluded: false },
      { id: "q2", number: 2, text: "", passage: "", answer: "9", standard: "", secondary: "", skill: "", dok: 1, alignment: 0, confidence: 0, level: "On grade", reasoning: "", verified: true, excluded: false },
    ],
  };
  const student = roster[0];
  const group = (pageUploadIds, responses) => ({ pageUploadIds, responses, studentId: student.id, name: student.name });
  // Front page answers q1; back page answers q2 (and leaves q1 blank).
  const front = group(["p0"], [{ questionId: "q1", answer: "4", verdict: "match", finalAnswer: "4" }, { questionId: "q2", answer: "", verdict: "blank", finalAnswer: "" }]);
  const back = group(["p1"], [{ questionId: "q1", answer: "", verdict: "blank", finalAnswer: "" }, { questionId: "q2", answer: "9", verdict: "match", finalAnswer: "9" }]);
  const out = applyScannedGroups(a, roster, "c", [front, back]).assessment.responses;
  const q = (id) => out.find((r) => r.questionId === id);
  assert.equal(out.length, 2);
  assert.equal(q("q1").answer, "4");
  assert.equal(q("q1").correct, true, "the front page's correct answer survives the back page");
  assert.equal(q("q2").correct, true);
  // Two different answers for one question from two groups: Unsure, not a pick.
  const clash = group(["p2"], [{ questionId: "q1", answer: "7", verdict: "other", finalAnswer: "7" }, { questionId: "q2", answer: "", verdict: "blank", finalAnswer: "" }]);
  const out2 = applyScannedGroups(a, roster, "c", [front, clash]).assessment.responses;
  const c1 = out2.find((r) => r.questionId === "q1");
  assert.equal(c1.correct, false);
  assert.equal(c1.confidence, 0, "for the teacher");
});

test("split groups with different WORD answers are a clash for the teacher, not a silent pick (round-4 review)", () => {
  const { mergeSplitGroups } = bundle("lib/teacher-class-scan.ts");
  const r = (answer, confidence) => ({ id: answer, studentId: "s", questionId: "q", answer, finalAnswer: answer, correct: false, confidence, verified: false, misconception: "" });
  for (const [x, y] of [["The slope is positive", "The slope is negative"], ["It is 5", "It is 7"]]) {
    const [m] = mergeSplitGroups([r(x, 100)], [r(y, 95)]);
    assert.equal(m.confidence, 0, x + " / " + y + " goes to the teacher");
  }
  const [same] = mergeSplitGroups([r("1/2", 100)], [r("0.5", 100)]);
  assert.equal(same.confidence, 100, "equal values are not a clash");
});
