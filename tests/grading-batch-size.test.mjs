// Smaller class-set grading requests (Michael, 2 Nov 2026). Proven when a
// class set is graded in requests of 2 or 3 pages -- whichever finishes in the
// fewest rounds of three side by side -- a student is never split, and the
// time and cost against today are measured on the two recorded sets:
//   21 Oct 2026: 36 one-page students, graded in 10 requests (Ricky's class);
//   2 Nov 2026:  12 one-page students, graded in 2 requests of 7 and 5 pages
//                (Michael's "Story Organizer" set: the 7-page request is the
//                one that swapped two students' answers, scan 9df4a4a3).
// Every number below is a recorded duration or token count from the scans
// table (no ids, names or content). There is no API key in this environment,
// so the "after" side is the recorded per-request behaviour applied to the new
// plan, stated as an estimate:
//   time per request  = a + b x output tokens (least squares over 33 recorded
//                       grading requests, 20 Oct - 2 Nov);
//   output per student = the set's recorded output / its students (unchanged:
//                       the same answers are asked for);
//   input per request = prompt + pages x tokens per page; the prompt is the
//                       only thing a smaller request repeats. Measured from
//                       Michael's two requests of the same test (7 and 5
//                       pages), and for Ricky's test scaled by its prompt's
//                       length as the app builds it.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildSync } from "esbuild";

const ROOT = process.cwd();
function bundle(entry) {
  const r = buildSync({
    entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, absWorkingDir: ROOT,
    alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, () => ({}));
  return m.exports;
}
const C = bundle("lib/teacher-class-scan.ts");
const A = bundle("lib/analyze-shared.ts");

// ---- recorded grading requests: [output tokens, seconds] ----
const RECORDED = [
  [3489, 31.9], [3264, 29.7], [3008, 35.2], [985, 13.6], [2670, 24.2], [1563, 17.9], [1691, 28.7], [758, 12.8], [3074, 29.9], [1678, 23.4], [639, 12.7],
  [3090, 35.0], [2822, 29.6], [2994, 29.7], [2462, 29.3], [2784, 29.2], [1897, 23.3], [2588, 29.4], [1216, 18.2], [3481, 34.9], [1194, 17.9],
  [5477, 55.8], [5358, 56.3], [5063, 56.2], [2972, 33.4], [1304, 22.2], [5244, 55.6], [5462, 56.3], [3446, 39.3], [1632, 22.9], [576, 12.4],
  [8316, 68.2], [7023, 62.9],
];
const n = RECORDED.length;
const mo = RECORDED.reduce((s, [o]) => s + o, 0) / n;
const ms = RECORDED.reduce((s, [, t]) => s + t, 0) / n;
const B = RECORDED.reduce((s, [o, t]) => s + (o - mo) * (t - ms), 0) / RECORDED.reduce((s, [o]) => s + (o - mo) ** 2, 0);
const Aa = ms - B * mo;
const seconds = (out) => Aa + B * out;

// Prices, from the recorded costs: $0.20 per million input, $1.20 output.
const IN = 0.2 / 1e6, OUT = 1.2 / 1e6;
const COSTED = [[35027, 3090, 0.010713], [6777, 1194, 0.002788], [22538, 8316, 0.014487], [16774, 7023, 0.011782]];

// ---- the two recorded sets ----
const OCT21 = {
  students: 36, pagesEach: 1, requests: 10,
  inputTokens: 288093, outputTokens: 24528,
  // Each request's server time, recorded, in the order they ran.
  serverS: [35.0, 29.6, 29.7, 29.3, 29.2, 23.3, 29.4, 18.2, 34.9, 17.9],
  cost: 0.087052,
  // The test as the app builds its prompt: 2 questions, 505 characters of
  // question and key text, no passage (lengths only).
  questions: 2, questionChars: 505, passageChars: 0,
};
const NOV2 = {
  students: 12, pagesEach: 1, requests: 2,
  requestPages: [7, 5], inputTokens: [22538, 16774], outputTokens: 15339,
  serverS: [68.2, 62.9], cost: 0.026269,
  questions: 9, questionChars: 705, passageChars: 3287,
};

/** The class_scan prompt the app builds for a test of this shape (made-up text of the recorded lengths). */
function promptChars({ questions, questionChars, passageChars }) {
  const per = Math.floor(questionChars / questions / 2);
  const qs = Array.from({ length: questions }, (_, i) => ({
    id: "q" + (i + 1), number: i + 1, text: "x".repeat(per), passage: "", answer: "y".repeat(per),
    standard: "7.RP.3", secondary: "", skill: "s", dok: 2, costas: 2, alignment: 90, confidence: 90,
    level: "On grade", reasoning: "", verified: true, excluded: false,
  }));
  const a = {
    id: "a1", classId: "c1", title: "T", subject: "Math", grade: 7, framework: "California", createdAt: "",
    status: "Ready", source: "manual", targetStandards: ["7.RP.3"], answerKeyVerified: true, uploadIds: [],
    studentUploadIds: {}, responses: [], questions: qs, passage: passageChars ? "p".repeat(passageChars) : undefined,
  };
  const catalog = [{ code: "7.RP.3", title: "R", subject: "Math", grade: 7, framework: "California", domain: "", cluster: "", wording: "w" }];
  const p = A.analyzeInput.parse({ mode: "class_scan", grade: 7, subject: "Math", framework: "California", targetStandards: ["7.RP.3"], assessmentId: "a1", uploadIds: ["u0", "u1", "u2"], pageGroups: [[0], [1], [2]] });
  return A.buildPrompt(p, { assessments: [a], students: [], classes: [], lessons: [] }, catalog, true).task.length;
}

/** Runs requests `concurrency` at a time, each taking `durations[i]` seconds, in order. */
function wallClock(durations, concurrency) {
  const free = Array(concurrency).fill(0);
  for (const d of durations) {
    free.sort((x, y) => x - y);
    free[0] += d;
  }
  return Math.max(...free);
}

function plan(set, size) {
  const piles = Array.from({ length: set.students }, (_, i) => Array.from({ length: set.pagesEach }, (_, j) => i * set.pagesEach + j));
  const ids = piles.flat().map((p) => "u" + p);
  return size
    ? C.planScanBatches(piles, ids, set.questions, undefined, size)
    : C.planRemainingBatches(piles, ids, set.questions, []);
}

test("the recorded prices and the time model fit what was recorded", () => {
  for (const [i, o, cost] of COSTED) assert.ok(Math.abs(i * IN + o * OUT - cost) / cost < 0.03, `cost ${cost}`);
  const worst = Math.max(...RECORDED.map(([o, t]) => Math.abs(seconds(o) - t)));
  console.log(`time per grading request = ${Aa.toFixed(1)} s + ${(B * 1000).toFixed(2)} s per 1000 output tokens (worst miss ${worst.toFixed(1)} s over ${n} requests)`);
  assert.ok(B > 0 && Aa > 0);
});

test("grading requests hold 2 or 3 pages, by fewest rounds, and never split a student", () => {
  assert.equal(C.gradePagesPerBatch(Array.from({ length: 12 }, (_, i) => [i]), Array.from({ length: 12 }, (_, i) => "u" + i), 9), 2, "12 one-page students: six requests, two rounds");
  assert.equal(C.gradePagesPerBatch(Array.from({ length: 36 }, (_, i) => [i]), Array.from({ length: 36 }, (_, i) => "u" + i), 2), 3, "36: twelve requests, four rounds");
  assert.equal(C.gradePagesPerBatch(Array.from({ length: 7 }, (_, i) => [i]), Array.from({ length: 7 }, (_, i) => "u" + i), 9), 3, "7: three requests, one round");
  for (const b of plan(NOV2)) assert.ok(b.uploadIds.length <= 3);
  for (const b of plan(OCT21)) assert.ok(b.uploadIds.length <= 3);
  // A four-page student goes whole, alone.
  const piles = [[0], [1, 2, 3, 4], [5]];
  const batches = C.planRemainingBatches(piles, ["a", "b", "c", "d", "e", "f"], 5, []);
  assert.ok(batches.some((b) => b.groups.length === 1 && b.uploadIds.length === 4), "the long paper is graded whole");
  assert.deepEqual(batches.flatMap((b) => b.groupIndexes).sort(), [0, 1, 2]);
});

test("measured against today on the two recorded sets: time and cost per class set", () => {
  // Prompt tokens per request, from Michael's two requests of one test.
  const perPage = (NOV2.inputTokens[0] - NOV2.inputTokens[1]) / (NOV2.requestPages[0] - NOV2.requestPages[1]);
  const promptNov2 = NOV2.inputTokens[0] - perPage * NOV2.requestPages[0];
  // The same overhead per character of prompt for Ricky's test.
  const fixed = promptNov2 - promptChars(NOV2) / 4;
  const promptOct21 = fixed + promptChars(OCT21) / 4;
  assert.ok(promptNov2 > 1000 && promptNov2 < 5000, `prompt ${promptNov2}`);
  assert.ok(promptOct21 > 500 && promptOct21 < promptNov2, `prompt ${promptOct21}`);

  const rows = [];
  for (const [label, set, prompt, beforeS] of [
    ["21 Oct (36 students)", OCT21, promptOct21, wallClock(OCT21.serverS, C.GRADE_CONCURRENCY)],
    ["2 Nov (12 students)", NOV2, promptNov2, Math.max(...NOV2.serverS)],
  ]) {
    const batches = plan(set);
    const outPerStudent = set.outputTokens / set.students;
    const afterS = wallClock(batches.map((b) => seconds(b.groups.length * outPerStudent)), C.GRADE_CONCURRENCY);
    // Same answers out; the prompt is sent once more for every extra request.
    const extra = batches.length - set.requests;
    const afterCost = set.cost + extra * prompt * IN;
    rows.push({ label, beforeReq: set.requests, afterReq: batches.length, pages: Math.max(...batches.map((b) => b.uploadIds.length)), beforeS, afterS, beforeCost: set.cost, afterCost });
  }
  for (const r of rows)
    console.log(
      `${r.label}: requests ${r.beforeReq} -> ${r.afterReq} (at most ${r.pages} pages each); ` +
        `grading time ${Math.round(r.beforeS)} s -> about ${Math.round(r.afterS)} s; ` +
        `cost $${r.beforeCost.toFixed(4)} -> about $${r.afterCost.toFixed(4)} (+${((r.afterCost / r.beforeCost - 1) * 100).toFixed(1)}%)`,
    );
  // The smaller requests must not make the teacher wait meaningfully longer,
  // nor cost meaningfully more.
  for (const r of rows) {
    assert.ok(r.afterS <= r.beforeS * 1.1, `${r.label}: ${r.afterS} s vs ${r.beforeS} s`);
    assert.ok(r.afterCost <= r.beforeCost * 1.1, `${r.label}: $${r.afterCost} vs $${r.beforeCost}`);
  }
});
