// RULE R3 (no wrong student), gap G3: a resume never lays saved answers on
// groups other than the ones they were read from. docs/system-map.md.
//
// Reproduced 14 Oct 2026 with the real lib functions: a desktop whole-stack
// upload grades by NAME (groups [[0,1],[2,3],[4,5]]); if it failed after the
// first batch, the auto-resume re-planned the groups from the piles on screen
// -- one pile holding the whole stack -- accepted the saved progress because
// `nextBatch <= batches.length`, and showed ONE row with all six pages and the
// first student's answers, pre-filled as whichever name read most confidently
// in the stack: Ana's answers under Ben.
//
// The fix: progress records its layout (the body upload ids of every group it
// was numbered against). A resume uses that layout, never the current piles,
// and only when the pages are exactly the same; otherwise it stops and asks
// the teacher to grade again (planResume -> "changed"). A whole-stack upload
// is also never graded as one declared pile.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bundle } from "./lib/bundle.mjs";

const C = bundle("lib/teacher-class-scan.ts");
const S = bundle("lib/scan-session.ts");

const student = (id, name) => ({ id, classId: "c", name, color: "#000", evidence: [], notes: "" });
const roster = [student("ana", "Ana Torres"), student("ben", "Ben Okafor"), student("cy", "Cy Park")];
// Fronts carry the names (Ben read most confidently), backs carry none.
const names = [["Ana Torres", 70], ["", 0], ["Ben Okafor", 99], ["", 0], ["Cy Park", 80], ["", 0]].map(
  ([name, confidence], page) => ({ page, name, confidence }),
);
const ids = names.map((_, i) => "body-" + i);
const owner = (page) => ["ana", "ana", "ben", "ben", "cy", "cy"][page];

/** The first run: grouped by name, group 0 (Ana) graded, then it failed. */
function failedStackRun() {
  const pageGroups = C.groupPagesByName(names, (n) => C.rosterMatchCount(n, roster));
  const graded = [{ group: 0, responses: [{ questionId: "q1", answer: "Ana's answer", verdict: "other" }] }];
  return { pageGroups, graded, progress: { graded, nextBatch: 1, scanId: null, layout: pageGroups.map((g) => g.map((p) => ids[p])) } };
}

/** Every row the app pre-fills holds only that child's pages, and every
 * graded answer sits on a row whose pages belong to the answer's author. */
function assertNoWrongStudent(rows) {
  for (const row of rows) {
    for (const p of row.pageIndexes)
      if (row.studentId) assert.equal(owner(p), row.studentId, `page ${p} pre-filled as ${row.studentId}`);
    const authors = new Set(row.pageIndexes.map(owner));
    for (const r of row.responses)
      assert.ok(authors.has(r.answer.startsWith("Ana") ? "ana" : "?"), `"${r.answer}" shown on ${[...authors]}'s pages`);
  }
}

test("G3 reproduced: the old resume (groups from the piles on screen) files Ana's answers under Ben", () => {
  // What the panel did before: gradeCaptured passed piles.map(len) -- one pile
  // of six -- and accepted the progress because nextBatch <= batches.length.
  const { graded } = failedStackRun();
  const oldGroups = C.groupPagesByCapture([6]);
  const batches = C.planScanBatches(oldGroups, ids, 1);
  assert.ok(1 <= batches.length, "the old check accepted the saved progress");
  const [row] = C.resolveScannedGroups(oldGroups, names, graded, ids, roster);
  assert.equal(row.studentId, "ben");
  assert.deepEqual(row.responses.map((r) => r.answer), ["Ana's answer"]);
});

test("a failed whole-stack upload resumes on the groups it was graded against", () => {
  const { pageGroups, graded, progress } = failedStackRun();
  const plan = S.planResume(progress, ids);
  assert.equal(plan.kind, "resume");
  assert.deepEqual(plan.pageGroups, pageGroups, "the saved grouping, not the single pile on screen");
  const rows = C.resolveScannedGroups(plan.pageGroups, names, graded, ids, roster);
  assert.equal(rows.length, 3, "three students, not one");
  assertNoWrongStudent(rows);
  assert.deepEqual(rows[0].responses.map((r) => r.answer), ["Ana's answer"]);
  assert.deepEqual(rows[0].pageIndexes, [0, 1]);
});

test("progress saved before layouts existed is never resumed", () => {
  const { graded } = failedStackRun();
  assert.equal(S.planResume({ graded, nextBatch: 1, scanId: null }, ids).kind, "changed");
});

test("pages added, removed or reordered since the progress was saved: stop and ask, never guess", () => {
  const { progress } = failedStackRun();
  assert.equal(S.planResume(progress, [...ids, "body-new"]).kind, "changed", "a page added");
  assert.equal(S.planResume(progress, ids.slice(0, 5)).kind, "changed", "a page removed (undo)");
  assert.equal(S.planResume(progress, [ids[2], ids[3], ids[0], ids[1], ids[4], ids[5]]).kind, "changed", "reordered");
  assert.equal(S.planResume(progress, ["body-new", ...ids]).kind, "changed", "a page added at the front");
});

test("a saved group number the layout does not have is never resumed", () => {
  const { progress } = failedStackRun();
  const bad = { ...progress, graded: [...progress.graded, { group: 7, responses: [] }] };
  assert.equal(S.planResume(bad, ids).kind, "changed");
});

test("no progress: grade from the start", () => {
  assert.equal(S.planResume(null, ids).kind, "fresh");
});

test("the layout and the stack flag survive the account copy and the local draft", () => {
  const { progress } = failedStackRun();
  const pages = ids.map((bodyId, i) => ({ key: "k" + i, label: "Page", bodyId, stripId: null, pages: 1, stack: true }));
  const back = S.parseSession(JSON.parse(JSON.stringify({ v: 1, piles: [pages], progress, groups: null, discarded: [], pageUploadIds: [], grading: null })));
  assert.deepEqual(back.progress.layout, progress.layout);
  assert.ok(back.piles[0].every((p) => p.stack === true));
  assert.deepEqual(S.parseProgress(JSON.parse(JSON.stringify(progress))), progress);
});

test("the panel resumes only through planResume and never grades a stack upload as one pile", () => {
  const src = readFileSync("components/teacher-class-scan.tsx", "utf8").replace(/\/\/.*$/gm, "");
  const captured = src.slice(src.indexOf("async function gradeCaptured("));
  const body = captured.slice(0, captured.indexOf("setScanning(true)"));
  assert.match(body, /const stackPiles = piles\.map\(\(pile\) => pile\.some\(\(p\) => p\.stack\)\)/, "a stack pile is marked, so it is split by names");
  assert.match(body, /planResume\(progress,/);
  assert.match(body, /plan\?\.kind === "changed"[\s\S]*askToRegrade\(\)[\s\S]*return;/, "a changed stack stops and asks");
  // Banked progress always carries the layout it is numbered against.
  const banks = [...src.matchAll(/setProgress\(\{[^}]*\}\)/g)].map((m) => m[0]);
  assert.ok(banks.length >= 2, "found the progress writes");
  for (const b of banks) assert.match(b, /layout/, `progress saved without its layout: ${b}`);
  // The resume path in gradePages uses the saved groups and nothing else.
  assert.match(src, /const resuming = resume && resumeGroups \? resume : null/);
  assert.match(src, /const pageGroups = resumeGroups\s*\?\s*resumeGroups/);
  assert.match(src.slice(src.indexOf("async function startStackScan(")), /stack: true,/);
});

test("groupLayout records each group's body ids in group order", () => {
  assert.deepEqual(S.groupLayout([[0, 1], [2]], ["a", "b", "c"]), [["a", "b"], ["c"]]);
});

// ---- #140 review: the batch plan can change between a run and its resume ----
// nextBatch and the in-flight job are numbered against the batches as first
// planned; the plan depends on the question count (and on constants a deploy
// can change). Reproduced: 30 one-page students, 10 questions (6 per batch),
// batch 1 in flight; the key grows to 40 questions (1 per batch); the resume
// waited on the old job and laid its answers on the NEW batch 1 -- student 6's
// answers on student 1. Now a resume plans only the ungraded students, numbered
// in the whole scan, and waits on a job only if it was sent for exactly them.

const thirty = Array.from({ length: 30 }, (_, i) => [i]);
const thirtyIds = thirty.map((_, i) => "p" + i);
/** A fake model: answers each group with its own whole-scan number. */
const answerFor = (batch) => ({ groups: batch.groups.map((_, g) => ({ group: g, responses: [{ questionId: "q1", answer: "from group " + batch.groupIndexes[g], verdict: "other" }] })) });

test("drift reproduced: re-planning and skipping nextBatch lays an in-flight answer on the wrong student", async () => {
  const first = C.planScanBatches(thirty, thirtyIds, 10);
  const inFlightJob = answerFor(first[1]); // sent for groups 6-11
  const replanned = C.planScanBatches(thirty, thirtyIds, 40);
  const banked = first[0].groupIndexes.map((g) => ({ group: g, responses: [] }));
  let waited = false;
  const graded = await C.gradeInBatches(replanned, async (b) => (waited ? answerFor(b) : ((waited = true), inFlightJob)), undefined, 1, banked);
  const wrong = graded.filter((g) => g.responses[0] && g.responses[0].answer !== "from group " + g.group);
  assert.ok(wrong.length > 0, "the old resume put no answer on the wrong group -- the reproduction is stale");
});

test("a resume grades every remaining student once, each with their own answers, whatever the plan does", async () => {
  for (const [firstQ, resumeQ] of [[10, 40], [40, 10], [10, 10]]) {
    const first = C.planScanBatches(thirty, thirtyIds, firstQ);
    const banked = first[0].groupIndexes.map((g) => ({ group: g, responses: [{ questionId: "q1", answer: "from group " + g, verdict: "other" }] }));
    const progress = { graded: banked, nextBatch: 1, scanId: "job-1", inFlight: first[1].groupIndexes };
    const batches = C.planRemainingBatches(thirty, thirtyIds, resumeQ, banked);
    const wait = S.inFlightMatches(progress, batches[0].groupIndexes);
    assert.equal(wait, firstQ === resumeQ, `${firstQ}->${resumeQ}: wait on the old job only when it holds the same students`);
    const inFlightJob = answerFor(first[1]);
    let first_ = true;
    const graded = await C.gradeInBatches(batches, async (b) => {
      const r = first_ && wait ? inFlightJob : answerFor(b);
      first_ = false;
      return r;
    }, undefined, 0, banked);
    assert.deepEqual(graded.map((g) => g.group).sort((x, y) => x - y), thirty.map((_, i) => i), `${firstQ}->${resumeQ}: every student graded exactly once`);
    for (const g of graded) assert.equal(g.responses[0].answer, "from group " + g.group, `${firstQ}->${resumeQ}: group ${g.group} holds another student's answer`);
  }
});

test("two devices: the progress kept is the one with more students graded", () => {
  const page = (bodyId) => ({ key: bodyId, label: "Page", bodyId, stripId: null, pages: 1 });
  const base = { v: 1, piles: [[page("a")]], groups: null, discarded: [], pageUploadIds: [], grading: null };
  const more = { graded: [{ group: 0, responses: [] }, { group: 1, responses: [] }], nextBatch: 1, scanId: null };
  const fewer = { graded: [{ group: 0, responses: [] }], nextBatch: 3, scanId: null };
  assert.equal(S.mergeSessions({ ...base, progress: fewer }, { ...base, progress: more }).progress, more);
  assert.equal(S.mergeSessions({ ...base, progress: more }, { ...base, progress: fewer }).progress, more);
});

test("the panel plans only the ungraded students and never skips by nextBatch", () => {
  const src = readFileSync("components/teacher-class-scan.tsx", "utf8").replace(/\/\/.*$/gm, "");
  const run = src.slice(src.indexOf("async function gradePages("), src.indexOf("function showGraded("));
  assert.match(run, /planRemainingBatches\(/);
  assert.doesNotMatch(run, /resume\.nextBatch|resuming\?\.nextBatch/, "a resume must not skip batches by number");
  assert.match(run, /inFlightMatches\(resuming, batches\[0\]\.groupIndexes\)/);
  assert.match(run, /inFlight: batch\.groupIndexes/, "an in-flight job records the students it was sent for");
  const ask = src.slice(src.indexOf("function askToRegrade("), src.indexOf("async function gradeCaptured("));
  assert.match(ask, /id: "scan-regrade-" \+ a\.id/, "the prompt replaces itself instead of stacking");
  assert.match(ask, /gradeCapturedRef\.current\(true\)/, "the button runs the latest panel state");
});

// ---- #140 review, round 2 ----

test("a stack upload beside declared piles: only the stack is split by names (G17)", () => {
  // Pile 0: a stack of 4 pages (two students by name); pile 1: a camera pile
  // the teacher declared, whose front page has no legible name.
  const names = [["Ana Torres", 99], ["", 0], ["Ben Okafor", 99], ["", 0], ["", 0], ["", 0]].map(([name, confidence], page) => ({ page, name, confidence }));
  const groups = C.groupMixedPiles([4, 2], [true, false], names, (n) => C.rosterMatchCount(n, roster));
  assert.deepEqual(groups, [[0, 1], [2, 3], [4, 5]], "the declared pile stays its own student, not Ben's back pages");
  assert.deepEqual(C.namePilesFor([4, 2], [true, false]), [[0], [1], [2], [3], [4, 5]]);
  // The old rule: any stack page sent the whole scan to the names.
  assert.deepEqual(C.groupPagesByName(names, (n) => C.rosterMatchCount(n, roster)), [[0, 1], [2, 3, 4, 5]]);
});

test("the Grade again prompt is dismissed when a run starts and never re-grades over rows on screen", () => {
  const src = readFileSync("components/teacher-class-scan.tsx", "utf8").replace(/\/\/.*$/gm, "");
  const run = src.slice(src.indexOf("async function gradePages("));
  assert.match(run.slice(0, run.indexOf("let banked")), /toast\.dismiss\("scan-regrade-" \+ a\.id\)/);
  const ask = src.slice(src.indexOf("function askToRegrade("), src.indexOf("async function gradeCaptured("));
  assert.match(ask, /if \(scanningRef\.current \|\| groupsRef\.current\) return;/);
});
