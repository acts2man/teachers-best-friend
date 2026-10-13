// PR 2, item 1: names landed on the wrong student's pages.
//
// The saved name-pass results (12 Oct 2026) show the cause. The pass sent up to
// twelve name strips in one request and trusted the model to say which image
// each name came from, and it did not:
//   - a pilot teacher's 3-student set (two pages each, piles declared): the
//     names came back on pages 1, 2 and 3; the teacher confirmed the third
//     student's pages are 4 and 5, which got no name -> 2 of 3 matched;
//   - an 8-strip request on another set: every name came back one position
//     late (1, 3, 5, 7 instead of 0, 2, 4, 6);
//   - a 26-student set put a classmate's (correctly read) name on another
//     child's paper.
// The fix sends one request per declared pile, so a misplaced name stays on its
// own student. Names below are placeholders; the read positions and
// confidences are the ones in the saved result.
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
const { planNameBatches, mergeNameReads, groupPagesByCapture, groupPagesByName, resolveScannedGroups, mapLimit } = bundle("lib/teacher-class-scan.ts");

const roster = ["Avery Quinn", "Blake Rivera", "Casey Morgan"].map((name, i) => ({ id: "s" + i, classId: "c", name, color: "#000", evidence: [], notes: "" }));
const strips = ["n0", "n1", "n2", "n3", "n4", "n5"];
const pages = ["p0", "p1", "p2", "p3", "p4", "p5"];
const piles = groupPagesByCapture([2, 2, 2]); // [[0,1],[2,3],[4,5]]

test("reproduces the 2-of-3 set: the saved reads, through the old twelve-per-request plan", () => {
  // The old plan: all six strips in one request.
  const slices = [strips.map((id, page) => ({ id, page }))];
  // The saved result: names at positions 1, 2, 3 (the third at confidence 62).
  const saved = { pages: [
    { page: 0, name: "", confidence: 0 },
    { page: 1, name: "Avery Quinn", confidence: 96 },
    { page: 2, name: "Blake Rivera", confidence: 95 },
    { page: 3, name: "Casey Morgan", confidence: 62 },
    { page: 4, name: "", confidence: 0 },
    { page: 5, name: "", confidence: 0 },
  ] };
  const names = mergeNameReads(6, slices, [saved]);
  const rows = resolveScannedGroups(piles, names, [], pages, roster, strips);
  assert.deepEqual(rows.map((r) => r.studentId), ["s0", "s1", null], "2 of 3, the third left unnamed -- as reported");
});

// A stand-in for the model that does what the saved results show: it finds the
// names that are there, but reports each one position late.
const NAME_ON = { n0: "Avery Quinn", n2: "Blake Rivera", n4: "Casey Morgan" };
const lateByOne = (slice) => ({
  pages: slice.map((_, i) => {
    const source = slice[i - 1];
    const name = source ? NAME_ON[source.id] ?? "" : "";
    return { page: i, name, confidence: name ? 95 : 0 };
  }),
});

test("with one request per declared pile, a late-by-one read stays on its own student", () => {
  const slices = planNameBatches(strips, piles);
  assert.deepEqual(slices.map((s) => s.map((x) => x.page)), [[0, 1], [2, 3], [4, 5]], "one request per student");
  const names = mergeNameReads(6, slices, slices.map(lateByOne));
  const rows = resolveScannedGroups(piles, names, [], pages, roster, strips);
  assert.deepEqual(rows.map((r) => r.studentId), ["s0", "s1", "s2"], "3 of 3");
});

test("the same misreading model, through the old single request, crosses students", () => {
  const one = [strips.map((id, page) => ({ id, page }))];
  // Late by one can stay inside a 2-page pile, so shift by two to show what a
  // long request does: a name lands in the next student's pile.
  const shifted = { pages: one[0].map((_, i) => {
    const source = one[0][i - 2];
    const name = source ? NAME_ON[source.id] ?? "" : "";
    return { page: i, name, confidence: name ? 95 : 0 };
  }) };
  const crossed = resolveScannedGroups(piles, mergeNameReads(6, one, [shifted]), [], pages, roster, strips);
  assert.equal(crossed[0].studentId, null);
  assert.equal(crossed[1].studentId, "s0", "the first student's name pre-filled on the second student's paper");
});

test("without declared piles each page is read on its own", () => {
  assert.deepEqual(planNameBatches(strips, null).map((s) => s.length), [1, 1, 1, 1, 1, 1]);
});

test("pages with no strip are skipped and a very long pile is still split", () => {
  assert.deepEqual(planNameBatches(["a", null, "c"], [[0, 1, 2]]).map((s) => s.map((x) => x.page)), [[0, 2]]);
  const long = Array.from({ length: 30 }, (_, i) => "x" + i);
  assert.deepEqual(planNameBatches(long, [long.map((_, i) => i)], 12).map((s) => s.length), [12, 12, 6]);
});

test("mapLimit keeps order and never runs more than the limit at once", async () => {
  let running = 0;
  let peak = 0;
  const out = await mapLimit([5, 1, 4, 2, 3, 0], 2, async (v) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, v * 3));
    running--;
    return v * 10;
  });
  assert.deepEqual(out, [50, 10, 40, 20, 30, 0]);
  assert.equal(peak, 2);
});

test("the class scan and the replay both plan names per declared pile, and the route labels each image", () => {
  assert.match(readFileSync("components/teacher-class-scan.tsx", "utf8"), /planNameBatches\(\s*pages\.map\(\(p\) => p\.stripId\),\s*explicit \? groupPagesByCapture\(explicit\) : null,?\s*\)/);
  assert.match(readFileSync("lib/regression/runner.ts", "utf8"), /planNameBatches\(strips, declared \? groupPagesByCapture\(/);
  assert.match(readFileSync("app/api/analyze/route.ts", "utf8"), /labelledContent\(p\.mode, content\)/);
});

test("a failed name read leaves that pile unnamed instead of stopping the scan; all failing still stops it", async () => {
  const out = await mapLimit([1, 2, 3], 2, async (v) => { if (v === 2) throw new Error("x"); return v; }, () => 0);
  assert.deepEqual(out, [1, 0, 3]);
  await assert.rejects(() => mapLimit([1, 2], 2, async () => { throw new Error("down"); }, () => 0), /down/);
});

test("without onError, the first failure stops new work from starting", async () => {
  let started = 0;
  await assert.rejects(() => mapLimit(Array.from({ length: 20 }, (_, i) => i), 4, async (v) => {
    started++;
    await new Promise((r) => setTimeout(r, 2));
    if (v === 0) throw new Error("x");
    return v;
  }), /x/);
  assert.ok(started < 20, `only ${started} of 20 started`);
});

test("a stack without declared piles: a motto read again after another name does not start a student", () => {
  const read = [
    { page: 0, name: "Avery Quinn", confidence: 95 },
    { page: 1, name: "Hope Always", confidence: 88 }, // printed motto on a back page
    { page: 2, name: "Blake Rivera", confidence: 95 },
    { page: 3, name: "Hope Always", confidence: 87 },
  ];
  // Telling a motto from a student needs the roster (a recurring roster name is
  // a real student); see tests/name-grouping-cases.test.mjs for the cases.
  const onRoster = (name) => roster.some((s) => s.name.toLowerCase() === name.toLowerCase());
  // Two appearances: left for the teacher (see name-grouping-cases); three: a motto.
  assert.deepEqual(groupPagesByName(read, onRoster), [[0], [1], [2], [3]]);
  const three = [...read, { page: 4, name: "Casey Morgan", confidence: 95 }, { page: 5, name: "Hope Always", confidence: 86 }];
  assert.deepEqual(groupPagesByName(three, onRoster), [[0, 1], [2, 3], [4, 5]]);
  // Without one, the motto page is left for the teacher, never under a student.
  assert.deepEqual(groupPagesByName(read), [[0], [1], [2], [3]]);
  // A student whose name is read on both of their pages, one after the other, is still one student.
  assert.deepEqual(groupPagesByName([{ page: 0, name: "Avery Quinn", confidence: 95 }, { page: 1, name: "Avery Quinn", confidence: 90 }]), [[0, 1]]);
});
