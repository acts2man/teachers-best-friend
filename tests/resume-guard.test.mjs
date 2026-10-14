// Gap G1 (docs/system-map.md): resuming a class scan whose piles or batch plan
// changed since the progress was banked re-mapped the saved answers by index.
//
// The G3 PR records each run's pages and grouping and starts over when the
// pages differ. Three holes remained, each closed here:
//   1. progress saved with no record (before that PR) was still trusted and
//      re-mapped by index;
//   2. the batch plan can change while the pages do not (the teacher edits the
//      questions, so batches regroup): resuming at "batch 1" of a different
//      plan skipped students who were never graded;
//   3. a still-running AI job was resumed as whatever batch came first, even
//      when the plan had changed, so its answers -- numbered within ITS batch --
//      could land on other students.
//
// Made-up data only (rule R8).
import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

function bundle(path) {
  const r = buildSync({ entryPoints: [path], bundle: true, platform: "node", format: "cjs", write: false });
  const m = { exports: {} };
  new Function("module", "exports", r.outputFiles[0].text)(m, m.exports);
  return m.exports;
}
const { resumePlan, gradeInBatches, inFlightJob } = bundle("lib/teacher-class-scan.ts");
const { parseSession } = bundle("lib/scan-session.ts");

const ids = ["p0", "p1", "p2", "p3"];
const answer = (group) => ({ group, responses: [{ questionId: "q1", answer: "student " + group, verdict: "other" }] });
const batch = (groups) => ({ groupIndexes: groups, groups: groups.map((g) => [g]), uploadIds: groups.map((g) => ids[g]) });
/** A model stand-in: answers each group in the batch, numbered within the batch. */
const model = (asked) => async (b) => {
  asked.push(b.groupIndexes);
  return { groups: b.groupIndexes.map((g, i) => ({ ...answer(g), group: i })) };
};

test("G1: progress saved with no record of its pages is not resumed", () => {
  const legacy = { graded: [answer(0)], nextBatch: 1, scanId: null };
  const plan = resumePlan(legacy, ids, [1, 1, 1, 1]);
  assert.equal(plan.resume, null, "its answers could belong to other pages");
  assert.deepEqual(plan.explicit, [1, 1, 1, 1]);
});

test("G1: a changed batch plan never skips a student who was not graded", async () => {
  // Banked under a plan of one student per batch: student 0 graded, "next
  // batch" is 1. The questions changed and the plan is now two per batch.
  const asked = [];
  const graded = await gradeInBatches([batch([0, 1]), batch([2, 3])], model(asked), undefined, 1, [answer(0)]);
  const done = graded.map((g) => g.group).sort();
  assert.deepEqual(done, [0, 1, 2, 3], "student 1 is graded, not skipped with batch 0");
  assert.equal(graded.find((g) => g.group === 0).responses[0].answer, "student 0", "and student 0 keeps the banked answer");
});

test("a batch whose students are all banked is not sent again", async () => {
  const asked = [];
  await gradeInBatches([batch([0, 1]), batch([2, 3])], model(asked), undefined, 0, [answer(0), answer(1)]);
  assert.deepEqual(asked, [[2, 3]]);
});

test("G1: a running AI job is picked up only when the batch plan is unchanged", () => {
  const saved = { graded: [answer(0)], nextBatch: 1, scanId: "job-1", pageIds: ids, pageGroups: [[0], [1], [2], [3]], byName: false, batchPlan: [[0], [1], [2], [3]] };
  assert.equal(inFlightJob(saved, [batch([0]), batch([1]), batch([2]), batch([3])]), "job-1");
  // Same pages, different plan: the job's answers are numbered within a batch
  // that no longer exists. Not picked up.
  assert.equal(inFlightJob(saved, [batch([0, 1]), batch([2, 3])]), null);
  // No plan recorded: not picked up either.
  assert.equal(inFlightJob({ ...saved, batchPlan: undefined }, [batch([0]), batch([1]), batch([2]), batch([3])]), null);
});

test("the batch plan survives a session sync", () => {
  const progress = { graded: [answer(0)], nextBatch: 1, scanId: null, pageIds: ids, pageGroups: [[0], [1], [2], [3]], byName: false, batchPlan: [[0, 1], [2, 3]] };
  const s = parseSession({ v: 1, piles: [[]], progress, groups: null, discarded: [], pageUploadIds: [], grading: null });
  assert.deepEqual(s.progress.batchPlan, [[0, 1], [2, 3]]);
});
