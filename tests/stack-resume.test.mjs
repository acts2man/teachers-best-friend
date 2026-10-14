// Gap G3 (docs/system-map.md): a whole-stack upload that fails partway, then
// resumes, came back as ONE student holding every page, wearing the most
// confidently read name in the stack, with the first student's answers.
//
// Why: a whole-stack run groups pages by the names it reads, but the saved
// progress kept only "next batch". The auto-resume runs gradeCaptured, which
// passes the single pile [N], so the banked answers were laid onto a grouping
// that no longer existed. Now the progress carries the run's own page ids and
// page groups, and resumePlan hands them back.
//
// Made-up names and answers only (rule R8).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";

function bundle(path) {
  const r = buildSync({ entryPoints: [path], bundle: true, platform: "node", format: "cjs", write: false });
  const m = { exports: {} };
  new Function("module", "exports", r.outputFiles[0].text)(m, m.exports);
  return m.exports;
}
const { resumePlan, groupPagesByName, groupPagesByCapture, resolveScannedGroups } = bundle("lib/teacher-class-scan.ts");
const { parseSession, parseDraft } = bundle("lib/scan-session.ts");

// Three students, two pages each; the name is on the front page.
const ids = ["p0", "p1", "p2", "p3", "p4", "p5"];
const names = [
  { page: 0, name: "Ana Ruiz", confidence: 80 },
  { page: 1, name: "", confidence: 0 },
  { page: 2, name: "Ben Ito", confidence: 97 },
  { page: 3, name: "", confidence: 0 },
  { page: 4, name: "Cy Moss", confidence: 90 },
  { page: 5, name: "", confidence: 0 },
];
const roster = [
  { id: "s-ana", classId: "c1", name: "Ana Ruiz", color: "#000", evidence: [], notes: "" },
  { id: "s-ben", classId: "c1", name: "Ben Ito", color: "#000", evidence: [], notes: "" },
  { id: "s-cy", classId: "c1", name: "Cy Moss", color: "#000", evidence: [], notes: "" },
];
const answersFor = (who) => [{ questionId: "q1", answer: who + "'s answer", verdict: "other" }];

// The first attempt: no piles declared, so grouped by the names read.
const firstRunGroups = groupPagesByName(names, () => 1);
// It graded Ana, then the connection dropped. This is what it banked.
const banked = {
  graded: [{ group: 0, responses: answersFor("Ana") }],
  nextBatch: 1,
  scanId: null,
  pageIds: ids,
  pageGroups: firstRunGroups,
  byName: true,
};

test("the first attempt grouped the stack into three students", () => {
  assert.deepEqual(firstRunGroups, [[0, 1], [2, 3], [4, 5]]);
});

test("G3: the resume keeps the first attempt's groups, not gradeCaptured's single pile", () => {
  // gradeCaptured passes the one pile it knows about: six pages.
  const plan = resumePlan(banked, ids, [6]);
  assert.deepEqual(plan.pageGroups, [[0, 1], [2, 3], [4, 5]], "three students, as first grouped");
  assert.equal(plan.explicit, null, "names read one page per request, as a by-name run does");
  assert.equal(plan.resume, banked, "and the banked batch is reused");
  // Without it, this is what the resume graded: one student, six pages.
  assert.deepEqual(groupPagesByCapture([6]), [[0, 1, 2, 3, 4, 5]]);
});

test("G3: after the resume, each student's answers sit under their own name", () => {
  const plan = resumePlan(banked, ids, [6]);
  // The resume grades Ben and Cy; Ana's banked answers stay.
  const graded = [
    ...banked.graded,
    { group: 1, responses: answersFor("Ben") },
    { group: 2, responses: answersFor("Cy") },
  ];
  const rows = resolveScannedGroups(plan.pageGroups, names, graded, ids, roster);
  assert.equal(rows.length, 3);
  for (const [i, who] of ["Ana", "Ben", "Cy"].entries()) {
    assert.equal(rows[i].studentId, "s-" + who.toLowerCase(), `${who}'s pages matched to ${who}`);
    assert.equal(rows[i].responses[0].answer, who + "'s answer", `${who}'s answers on ${who}'s row`);
  }
});

test("a resume over different pages starts over instead of reusing banked answers", () => {
  const plan = resumePlan(banked, [...ids, "p6"], [7]);
  assert.equal(plan.resume, null);
  assert.equal(plan.pageGroups, null, "grouped afresh from the pages now there");
  assert.deepEqual(plan.explicit, [7]);
});

test("progress saved before this change is not resumed (gap G1: nothing says which pages its answers belong to)", () => {
  const legacy = { graded: banked.graded, nextBatch: 1, scanId: null };
  const plan = resumePlan(legacy, ids, [2, 2, 2]);
  assert.equal(plan.resume, null);
  assert.equal(plan.pageGroups, null);
  assert.deepEqual(plan.explicit, [2, 2, 2]);
});

test("the record survives a session sync (normalizeSession used to drop unknown progress fields)", () => {
  const s = parseSession({ v: 1, piles: [[]], progress: banked, groups: null, discarded: [], pageUploadIds: [], grading: null });
  assert.deepEqual(s.progress.pageIds, ids);
  assert.deepEqual(s.progress.pageGroups, firstRunGroups);
  assert.equal(s.progress.byName, true);
  // Malformed records are dropped, not trusted.
  const bad = parseSession({ v: 1, piles: [[]], progress: { ...banked, pageGroups: [[0, "x"]] }, groups: null, discarded: [], pageUploadIds: [], grading: null });
  assert.equal(bad.progress.pageGroups, undefined);
});

test("G3 after a reload: the local draft keeps the run's grouping, so the resume still grades three students", () => {
  // The panel's first render reads the browser draft and auto-resumes from it,
  // before the account copy arrives -- the commonest way back into a scan (the
  // tab closed, the phone slept). The draft used to drop the grouping.
  const pages = ids.map((bodyId, i) => ({ key: "k" + i, label: "Page", bodyId, stripId: "n" + i, pages: 1 }));
  const now = Date.UTC(2026, 9, 14);
  const raw = JSON.stringify({ piles: [pages], progress: banked, savedAt: now - 60_000 });
  const draft = parseDraft(raw, now);
  assert.deepEqual(draft.progress.pageGroups, firstRunGroups);
  assert.deepEqual(draft.progress.pageIds, ids);
  // gradeCaptured resumes with the panel's one pile of six pages.
  const plan = resumePlan(draft.progress, draft.piles.flat().map((p) => p.bodyId), [6]);
  assert.deepEqual(plan.pageGroups, [[0, 1], [2, 3], [4, 5]]);
  // A draft older than its pages is still dropped; a bare-array draft still reads.
  assert.equal(parseDraft(JSON.stringify({ piles: [pages], progress: banked, savedAt: now - 8 * 86_400_000 }), now), null);
  assert.equal(parseDraft(JSON.stringify([pages]), now).progress, null);
});

test("every save of progress in the grading run records the grouping", () => {
  const src = readFileSync("components/teacher-class-scan.tsx", "utf8");
  const body = src.slice(src.indexOf("async function gradePages("), src.indexOf("function showGraded"));
  assert.match(body, /resumePlan\(saved \?\? null, ids, asked\)/);
  const at = [...body.matchAll(/setProgress\(/g)].map((m) => m.index);
  assert.ok(at.length >= 2, "both banked saves found");
  for (const i of at) {
    const call = body.slice(i, body.indexOf(")", body.indexOf("}", i)) + 1);
    // A clear is setProgress(null); every other save must carry the grouping.
    if (/^setProgress\(null\)/.test(call)) continue;
    assert.match(call, /\.\.\.grouping/, call);
  }
  // The panel reads its draft through the shared reader, not its own copy.
  assert.match(src, /parseDraft\(savedRaw\)/);
  assert.doesNotMatch(src, /function parseDraft\(/);
});
