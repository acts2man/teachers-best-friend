// A whole class set, start to finish, through the real pipeline.
//
// Everything here is the code the app runs: planScanBatches, gradeInBatches,
// resolveScannedGroups, applyScannedGroups. Only the network is simulated --
// the model is replaced by a stub that answers the way the schema says it will,
// numbering its groups from zero within each batch exactly as a real request
// does.
//
// The failure this is really guarding against: each batch returns a "group 0",
// and if those are not mapped back to whole-scan numbering, thirty-six students
// collapse onto the first few, every child holding another child's grades, with
// nothing on screen to suggest anything is wrong. A teacher would not catch it.
import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

function bundle(path) {
  const r = buildSync({ entryPoints: [path], bundle: true, platform: "node", format: "cjs", write: false });
  const m = { exports: {} };
  new Function("module", "exports", r.outputFiles[0].text)(m, m.exports);
  return m.exports;
}
const {
  planScanBatches, gradeInBatches, groupPagesByCapture,
  resolveScannedGroups, applyScannedGroups,
} = bundle("lib/teacher-class-scan.ts");

const CLASS_SIZE = 36;
const QUESTIONS = 10;
const PAGES_EACH = 2; // front and back

const questions = Array.from({ length: QUESTIONS }, (_, i) => ({
  id: "q" + i, number: i + 1, text: "Question " + (i + 1), passage: "",
  answer: String(i + 1), standard: "7.RP.3", secondary: "", skill: "percent",
  dok: 2, alignment: 100, confidence: 100, level: "On grade", reasoning: "",
  verified: true, excluded: false,
}));

const assessment = {
  id: "a1", classId: "c1", title: "3.1-3.3 Percent Problems", subject: "Math",
  grade: 7, framework: "California", createdAt: "", status: "Ready",
  source: "manual", targetStandards: ["7.RP.3"], answerKeyVerified: true,
  questions, responses: [], uploadIds: [], studentUploadIds: {},
};

// Real-shaped names: distinct first names with distinct last initials, because
// matchRosterStudent strips digits and punctuation, so "Student 01 T." and
// "Student 02 T." are the same name to it. Every student answers distinctively
// too, so a misattributed grade is detectable rather than merely possible.
const FIRST_NAMES = [
  "Amelia", "Benjamin", "Chloe", "Daniel", "Ella", "Ethan", "Grace", "Henry",
  "Isabella", "Jack", "Liam", "Lucas", "Mason", "Mia", "Noah", "Olivia",
  "Owen", "Penelope", "Quinn", "Rocco", "Sofia", "Theo", "Violet", "William",
  "Zoe", "Aiden", "Charlotte", "Demitri", "Easton", "Freya", "Gabriel",
  "Hayat", "Ivy", "Jonah", "Kensington", "Landon",
];
const LAST_INITIALS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij".split("");
const roster = Array.from({ length: CLASS_SIZE }, (_, i) => ({
  id: "s" + i,
  name: FIRST_NAMES[i] + " " + LAST_INITIALS[i].toUpperCase() + ".",
  answerFor: (q) => "S" + i + "-Q" + q,
}));

test("the test roster is unambiguous, so a failure below means the code", () => {
  assert.equal(new Set(roster.map((s) => s.name)).size, CLASS_SIZE);
});

const uploadIds = Array.from({ length: CLASS_SIZE * PAGES_EACH }, (_, i) => "upload-" + i);
const pageGroups = groupPagesByCapture(Array(CLASS_SIZE).fill(PAGES_EACH));

/** Stands in for the model: grades only the students it was shown, and numbers
 * them from zero within the batch, exactly as a real request does. */
function fakeModel(batch) {
  return Promise.resolve({
    groups: batch.groups.map((_, groupInBatch) => {
      const student = roster[batch.groupIndexes[groupInBatch]];
      return {
        group: groupInBatch,
        responses: questions.map((q, qi) => ({
          questionId: q.id,
          answer: student.answerFor(qi),
          correct: qi % 2 === 0,
          match: qi % 2 === 0 ? 100 : 40,
          misconception: "",
          confidence: 99,
        })),
      };
    }),
  });
}

test("a full class set grades every student, and grades the right one", async () => {
  const batches = planScanBatches(pageGroups, uploadIds, QUESTIONS);
  assert.ok(batches.length > 1, "a class this size should need more than one request");

  const graded = await gradeInBatches(batches, fakeModel);
  assert.equal(graded.length, CLASS_SIZE, "every student should come back graded");

  const names = roster.map((s, i) => ({ page: i * PAGES_EACH, name: s.name, confidence: 95 }));
  const resolved = resolveScannedGroups(pageGroups, names, graded, uploadIds, roster);
  assert.equal(resolved.length, CLASS_SIZE);

  // The real test: every student holds their own answers, not a neighbour's.
  for (const [i, row] of resolved.entries()) {
    assert.equal(row.studentId, roster[i].id, "group " + i + " resolved to the wrong student");
    assert.equal(
      row.responses[0].answer,
      roster[i].answerFor(0),
      "student " + i + " was given another student's answers",
    );
  }
});

test("saving the scan attaches each student's work to that student", async () => {
  const batches = planScanBatches(pageGroups, uploadIds, QUESTIONS);
  const graded = await gradeInBatches(batches, fakeModel);
  const names = roster.map((s, i) => ({ page: i * PAGES_EACH, name: s.name, confidence: 95 }));
  const resolved = resolveScannedGroups(pageGroups, names, graded, uploadIds, roster);

  const saved = applyScannedGroups(assessment, roster, "c1", resolved.map((g) => ({
    studentId: g.studentId, name: g.name, pageUploadIds: g.pageUploadIds, responses: g.responses,
  })));

  assert.equal(saved.studentCount, CLASS_SIZE);
  assert.equal(saved.newStudents.length, 0, "nobody should be invented for a matched roster");
  assert.equal(saved.assessment.responses.length, CLASS_SIZE * QUESTIONS);

  for (const [i, student] of roster.entries()) {
    const mine = saved.assessment.responses.filter((r) => r.studentId === student.id);
    assert.equal(mine.length, QUESTIONS, "student " + i + " has the wrong number of answers");
    const first = mine.find((r) => r.questionId === "q0");
    assert.equal(first.answer, student.answerFor(0), "student " + i + " holds the wrong work");
    assert.deepEqual(
      saved.assessment.studentUploadIds[student.id],
      [uploadIds[i * PAGES_EACH], uploadIds[i * PAGES_EACH + 1]],
      "student " + i + " is linked to the wrong pages",
    );
  }
});

test("a batch that fails part-way keeps what was already graded", async () => {
  const batches = planScanBatches(pageGroups, uploadIds, QUESTIONS);
  let banked = [];
  let next = 0;
  await assert.rejects(
    gradeInBatches(
      batches,
      (batch, index) => (index === 2 ? Promise.reject(new Error("connection dropped")) : fakeModel(batch)),
      (graded, nextBatch) => { banked = graded; next = nextBatch; },
    ),
    /connection dropped/,
  );
  assert.equal(next, 2, "should have banked the two batches that succeeded");
  assert.ok(banked.length > 0);
  // Resuming finishes the class without re-grading what is already done.
  const finished = await gradeInBatches(batches, fakeModel, undefined, next, banked);
  assert.equal(finished.length, CLASS_SIZE);
  assert.deepEqual([...new Set(finished.map((g) => g.group))].sort((a, b) => a - b),
    [...Array(CLASS_SIZE).keys()]);
});

test("an answer for a group the batch was never told about is dropped, not misfiled", async () => {
  const batches = planScanBatches(pageGroups, uploadIds, QUESTIONS);
  const graded = await gradeInBatches(batches, async (batch) => {
    const real = await fakeModel(batch);
    return { groups: [...real.groups, { group: 999, responses: [] }] };
  });
  assert.equal(graded.length, CLASS_SIZE, "a stray group number leaked into the results");
});

test("an odd class size still grades everyone, including a short last batch", async () => {
  for (const size of [1, 7, 13, 29]) {
    const ids = Array.from({ length: size * PAGES_EACH }, (_, i) => "u" + i);
    const groups = groupPagesByCapture(Array(size).fill(PAGES_EACH));
    const graded = await gradeInBatches(
      planScanBatches(groups, ids, QUESTIONS),
      (batch) => Promise.resolve({
        groups: batch.groups.map((_, g) => ({ group: g, responses: [] })),
      }),
    );
    assert.equal(graded.length, size, "class of " + size + " lost a student");
    assert.deepEqual([...new Set(graded.map((g) => g.group))].sort((a, b) => a - b),
      [...Array(size).keys()], "class of " + size + " mis-numbered a student");
  }
});

test("a run that fails part-way leaves the graded students resolvable", async () => {
  const batches = planScanBatches(pageGroups, uploadIds, QUESTIONS);
  let banked = [];
  await assert.rejects(
    gradeInBatches(
      batches,
      (batch, index) => (index === 3 ? Promise.reject(new Error("out of scans")) : fakeModel(batch)),
      (graded) => { banked = graded; },
    ),
    /out of scans/,
  );
  assert.ok(banked.length > 0, "nothing was banked before the failure");

  // What the panel does with what it has: resolve, then keep only the groups
  // that actually came back. A teacher has already paid for these.
  const names = roster.map((s, i) => ({ page: i * PAGES_EACH, name: s.name, confidence: 95 }));
  const done = new Set(banked.map((g) => g.group));
  const shown = resolveScannedGroups(pageGroups, names, banked, uploadIds, roster)
    .filter((_, i) => done.has(i));

  assert.equal(shown.length, banked.length, "a graded student was dropped from the review list");
  for (const row of shown) {
    assert.ok(row.responses.length > 0, "a student shown for review has no grades");
    const i = roster.findIndex((s) => s.id === row.studentId);
    assert.ok(i >= 0, "a shown student is not on the roster");
    assert.equal(row.responses[0].answer, roster[i].answerFor(0), "a partial result was misattributed");
  }
});

test("students the failed run never reached are not shown as empty rows", async () => {
  const batches = planScanBatches(pageGroups, uploadIds, QUESTIONS);
  let banked = [];
  await assert.rejects(
    gradeInBatches(batches, (b, i) => (i === 1 ? Promise.reject(new Error("stop")) : fakeModel(b)),
      (g) => { banked = g; }),
    /stop/,
  );
  const names = roster.map((s, i) => ({ page: i * PAGES_EACH, name: s.name, confidence: 95 }));
  const done = new Set(banked.map((g) => g.group));
  const shown = resolveScannedGroups(pageGroups, names, banked, uploadIds, roster)
    .filter((_, i) => done.has(i));
  assert.ok(shown.length < CLASS_SIZE, "the whole class was shown after a partial run");
  assert.ok(shown.every((r) => r.responses.length > 0), "an ungraded student was offered for review");
});
