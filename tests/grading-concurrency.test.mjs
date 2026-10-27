// Faster grading (26 Oct 2026): grading requests run three at a time, and,
// when the teacher declared the piles, start while the names are still being
// read. Nothing a request carries changes -- no prompt, image or model -- so
// the proof is that the RESULTS are identical and only the waiting changes.
//
// (A) gradeInBatches, three at a time, returns exactly what it returns one at
//     a time on a made-up 36-student class, short batches re-asked and
//     multi-part answers re-asked included; never more than three requests
//     in flight; banked in batch order however they finish; a failure keeps
//     what was already running.
// (B) The 21 Oct 2026 class set replayed on a virtual clock: its 36 name reads
//     and 10 grading requests with their RECORDED durations (scans table,
//     durations only -- no ids, names or answers), and made-up answers,
//     because a class scan's results are not kept. The old order (names, then
//     each batch in turn) and the new one give identical names and grades, and
//     the total time of each is logged.
// Made-up students only (R8).
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
const C = bundle("lib/teacher-class-scan.ts");

// ---- a virtual clock: every wait is instant, in a fixed order ----
function clock() {
  let now = 0;
  const timers = [];
  let seq = 0;
  const sleep = (ms) => new Promise((r) => timers.push({ at: now + ms, seq: seq++, r }));
  const flush = () => new Promise((r) => setImmediate(r));
  async function run(promise) {
    let settled = false;
    const out = promise.finally(() => (settled = true));
    out.catch(() => {});
    while (!settled) {
      await flush();
      if (settled) break;
      if (!timers.length) {
        await flush();
        if (!timers.length && !settled) throw new Error("deadlock: nothing to wait for");
        continue;
      }
      timers.sort((x, y) => x.at - y.at || x.seq - y.seq);
      const t = timers.shift();
      now = t.at;
      t.r();
    }
    return out;
  }
  return { sleep, run, now: () => now };
}

// ---- a made-up class: 36 students, 1-4 pages each, 6 questions (Q3 has 2 parts) ----
const QUESTIONS = ["q1", "q2", "q3", "q4", "q5", "q6"];
const assessment = { questions: QUESTIONS.map((id) => ({ id, answerParts: id === "q3" ? 2 : undefined })) };
const pagesPer = Array.from({ length: 36 }, (_, i) => 1 + ((i * 7) % 4));
let p = 0;
const pageGroups = pagesPer.map((n) => Array.from({ length: n }, () => p++));
const ids = pageGroups.flat().map((i) => "u" + i);
const batches = C.planScanBatches(pageGroups, ids, QUESTIONS.length);

// The "model": a fixed answer per student; some first answers come back short
// (a student left out, or Q3 with one part), as real ones do.
function answerFor(group, q, full) {
  if (q === "q3") return { questionId: q, answer: full ? "4; 9" : "4", finalAnswer: full ? "4; 9" : "4", verdict: "other" };
  return { questionId: q, answer: String((group * 3 + q.length) % 11), verdict: (group + q.length) % 3 ? "match" : "other" };
}
function fakeModel(sleep, durationOf, clean = false) {
  const asked = new Map();
  const inFlight = { now: 0, max: 0 };
  const grade = async (batch, index) => {
    const key = batch.groupIndexes.join(",") + "|" + (batch.onlyQuestionIds ?? []).join(",");
    const n = (asked.get(key) ?? 0) + 1;
    asked.set(key, n);
    inFlight.now++;
    inFlight.max = Math.max(inFlight.max, inFlight.now);
    await sleep(durationOf(index, n, batch));
    inFlight.now--;
    const groups = batch.groupIndexes
      // Every fourth batch's first answer leaves its last student out.
      .filter((at, local) => clean || !(n === 1 && index % 4 === 1 && local === batch.groupIndexes.length - 1))
      .map((at) => ({
        group: batch.groupIndexes.indexOf(at),
        responses: (batch.onlyQuestionIds?.length ? batch.onlyQuestionIds : QUESTIONS).map((q) =>
          // Q3 comes back with one part the first time for every fifth student.
          answerFor(at, q, clean || !(q === "q3" && at % 5 === 0 && !batch.onlyQuestionIds)),
        ),
      }));
    return { groups };
  };
  return { grade, inFlight, asked };
}

async function gradeAll(concurrency, durationOf, opts = {}) {
  const c = clock();
  const model = fakeModel(c.sleep, durationOf);
  const banks = [];
  const result = await c.run(
    C.gradeInBatches(
      batches,
      opts.grade ? opts.grade(model.grade) : model.grade,
      (soFar, next) => banks.push({ groups: soFar.map((g) => g.group), next }),
      0,
      [],
      QUESTIONS.length,
      2,
      undefined,
      assessment,
      undefined,
      concurrency,
    ),
  );
  return { result, banks, max: model.inFlight.max, time: c.now() };
}

test("(A) three at a time grades exactly what one at a time does", async () => {
  // Durations that make batches finish out of order: later batches are quicker.
  const durationOf = (index, n) => (n === 1 ? 40 - index * 3 : 10) * 1000;
  const one = await gradeAll(1, durationOf);
  const three = await gradeAll(3, durationOf);
  assert.ok(batches.length >= 8, `a class-sized plan (${batches.length} batches)`);
  assert.equal(one.result.length, 36);
  assert.deepEqual(three.result, one.result, "the same students, answers and order");
  assert.equal(one.max, 1);
  assert.equal(three.max, 3, "three requests in flight, never more");
  assert.ok(three.time < one.time / 2, `faster: ${three.time / 1000} s against ${one.time / 1000} s`);
});

test("(A) banked in batch order, and a resume carries on from the first batch not back", async () => {
  const durationOf = (index, n) => (n === 1 ? 40 - index * 3 : 10) * 1000;
  const three = await gradeAll(3, durationOf);
  for (const b of three.banks) {
    const sorted = [...b.groups].sort((x, y) => x - y);
    assert.deepEqual(b.groups, sorted, "never a later student before an earlier one");
    // Everything before `next` is banked.
    for (const k of batches.slice(0, b.next).flatMap((x) => x.groupIndexes)) assert.ok(b.groups.includes(k));
  }
  assert.equal(three.banks.at(-1).next, batches.length);
});

test("(A) a failed batch: nothing new starts, the running ones are kept, the error is thrown", async () => {
  const c = clock();
  const model = fakeModel(c.sleep, () => 30000);
  const started = [];
  let banked = [];
  const run = C.gradeInBatches(
    batches,
    async (batch, index) => {
      if (batch === batches[index]) started.push(index);
      if (index === 1) {
        await c.sleep(5000);
        throw new Error("model unavailable");
      }
      return model.grade(batch, index);
    },
    (soFar) => (banked = soFar.map((g) => g.group)),
    0,
    [],
    QUESTIONS.length,
    2,
    undefined,
    undefined,
    undefined,
    3,
  );
  await assert.rejects(c.run(run), /model unavailable/);
  assert.deepEqual(started, [0, 1, 2], "batch 3 was never sent");
  for (const k of [...batches[0].groupIndexes, ...batches[2].groupIndexes]) assert.ok(banked.includes(k), "batches 0 and 2 finished and were banked");
  assert.ok(!banked.some((k) => batches[1].groupIndexes.includes(k)));
});

test("(A) one at a time is unchanged: the default, and what other callers get", () => {
  const src = readFileSync("lib/teacher-class-scan.ts", "utf8");
  assert.match(src, /\n  concurrency = 1,\n\): Promise<GradedGroup\[\]>/);
  assert.match(src, /export const GRADE_CONCURRENCY = 3;/);
  const ui = readFileSync("components/teacher-class-scan.tsx", "utf8");
  assert.match(ui, /GRADE_CONCURRENCY,\n\s*\);\n\s*\};/, "the class scan passes it");
  // With the teacher's piles (or a resume's saved groups), grading starts
  // before the names are waited on; a whole stack still waits for them.
  const run = ui.slice(ui.indexOf("async function gradePages("), ui.indexOf("function showGraded("));
  assert.match(run, /const known = resumeGroups \?\? \(explicit && !mixed \? groupPagesByCapture\(explicit\) : null\);/);
  assert.ok(run.indexOf("grading = gradeGroups(known);") > 0 && run.indexOf("grading = gradeGroups(known);") < run.indexOf("names = await readNames();"));
  assert.match(run, /const graded = await \(grading \?\? gradeGroups\(pageGroups\)\);/);
});

// ---- (B) the recorded class set ----
// 21 Oct 2026, 36 name reads and 10 grading requests, seconds. Each name
// read's server time, and each grading request's time as the teacher waited
// on it: from its start to the next one's start (the app polls for the
// answer), the last one its server time plus the mean of those gaps.
const NAME_S = [6.9, 5.8, 6.3, 6.1, 6.0, 6.9, 5.7, 5.8, 6.0, 5.9, 5.8, 5.8, 5.8, 6.0, 5.8, 5.9, 6.0, 5.9, 5.8, 5.7, 6.1, 5.8, 5.9, 5.8, 5.7, 5.7, 5.8, 5.9, 5.7, 5.8, 5.7, 5.9, 5.7, 5.7, 5.7, 5.7];
const GRADE_START_S = [101.9, 147.5, 189.5, 222.3, 263.2, 294.4, 330.2, 362.1, 392.4, 429.0];
const GRADE_SERVER_S = [35.0, 29.6, 29.7, 29.3, 29.2, 23.3, 29.4, 18.2, 34.9, 17.9];
const RECORDED_TOTAL_S = 447;
const RECORDED_NAMES_DONE_S = 90;
const gaps = GRADE_START_S.slice(1).map((s, i) => s - (GRADE_START_S[i] + GRADE_SERVER_S[i]));
const meanGap = gaps.reduce((x, y) => x + y, 0) / gaps.length;
const GRADE_WAIT_S = GRADE_SERVER_S.map((d, i) => (i < 9 ? GRADE_START_S[i + 1] - GRADE_START_S[i] : d + meanGap));
// The name reads ran four at a time and were done at 90 s: the same polling
// overhead per read, worked out so the old order reproduces that.
const NAME_OVERHEAD_S = 4.0;
// Between the last name and the first grading request: 12 s, kept in both.
const SETUP_S = GRADE_START_S[0] - RECORDED_NAMES_DONE_S;

async function replay({ concurrency, overlap }) {
  const c = clock();
  const names = NAME_S.map((d, i) => ({ i, d }));
  const readNames = () =>
    C.mapLimit(names, C.NAME_CONCURRENCY, async ({ i, d }) => {
      await c.sleep((d + NAME_OVERHEAD_S) * 1000);
      return { page: i, name: "Student " + (i + 1), confidence: 90 };
    });
  // The recorded run's ten requests, in its order (made-up students).
  const recorded = Array.from({ length: 10 }, (_, k) => batches[k % batches.length]);
  // Every recorded request answered in one attempt, so nothing is re-asked.
  const model = fakeModel(c.sleep, (index) => GRADE_WAIT_S[index] * 1000, true);
  const gradeRun = () =>
    C.gradeInBatches(recorded, model.grade, undefined, 0, [], QUESTIONS.length, 2, undefined, assessment, undefined, concurrency);
  let namesDone = 0;
  const work = (async () => {
    if (overlap) {
      const grading = c.sleep(SETUP_S * 1000).then(gradeRun);
      const n = await readNames();
      namesDone = c.now();
      return { names: n, graded: await grading };
    }
    const n = await readNames();
    namesDone = c.now();
    await c.sleep(SETUP_S * 1000);
    return { names: n, graded: await gradeRun() };
  })();
  const out = await c.run(work);
  return { ...out, total: c.now() / 1000, namesDone: namesDone / 1000 };
}

test("(B) the recorded 21 Oct class set: identical names and grades, and the time each takes", async () => {
  const before = await replay({ concurrency: 1, overlap: false });
  const after = await replay({ concurrency: C.GRADE_CONCURRENCY, overlap: true });
  // The old order reproduces what was recorded (to within the rounding of
  // the recorded times), so the new number is about the same run.
  assert.ok(Math.abs(before.namesDone - RECORDED_NAMES_DONE_S) <= 5, `names done at ${before.namesDone} s (recorded ${RECORDED_NAMES_DONE_S})`);
  assert.ok(Math.abs(before.total - RECORDED_TOTAL_S) <= 15, `old order ${before.total} s (recorded ${RECORDED_TOTAL_S})`);
  assert.deepEqual(after.names, before.names, "identical names");
  assert.deepEqual(after.graded, before.graded, "identical grades");
  console.log(
    `recorded class set (36 piles, 10 grading requests): before ${Math.round(before.total)} s ` +
      `(recorded ${RECORDED_TOTAL_S} s), after ${Math.round(after.total)} s; names done at ${Math.round(after.namesDone)} s either way`,
  );
  assert.ok(after.total < before.total / 2);
});
