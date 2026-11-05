// Leftovers from review (5 Nov 2026). Proven when:
//   #199 - the full lesson failing says "Nothing was charged" (its credit was
//          released when it failed), never "contact support", and no refund
//          is asked for it;
//        - with no credits left nothing is started, and the two free versions
//          start only once the full lesson is accepted, so a refusal (402)
//          never runs them;
//        - (SQL: tests/refund-sql.test.mjs) only a failed "flow" of the run
//          refunds, never a failed "question";
//   #200 - in auto-capture mode a shutter press the teacher made gets
//          Retake / Keep instead of being dropped silently; auto-snap keeps
//          its hint.
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
const B = bundle("lib/lesson-billing.ts");
const L = bundle("lib/teacher-lessons.ts");
const planning = readFileSync("components/teacher-planning.tsx", "utf8");
const camera = readFileSync("components/scan-camera.tsx", "utf8");
const flow = { materials: ["m"], phases: [{ time: "0-5", name: "Go", text: "t" }] };

test("#199: the full lesson failing says nothing was charged, never 'contact support'", () => {
  for (const refunded of [null, false, true]) {
    const flowsOnly = L.generateOutcome("Visual", null, [["Kinesthetic", flow], ["Auditory", flow]]);
    const msg = L.generateMessage(flowsOnly, refunded);
    assert.match(msg, /Nothing was charged\./);
    assert.doesNotMatch(msg, /contact support|weren’t charged/);
    const none = L.generateMessage(L.generateOutcome("Visual", null, [["Kinesthetic", null], ["Auditory", null]]), refunded);
    assert.match(none, /none of the three versions came back\. Nothing was charged\./);
  }
  const gen = planning.slice(planning.indexOf("async function generateAI("), planning.indexOf("\"Add question\" (Ricky"));
  assert.match(gen, /const refunded = outcome\.missing\.length && !outcome\.fullMissing \? await refundLesson\(lessonRun\) : null;/, "no refund is asked for a failed full lesson");
});

test("#199: with no credits left nothing starts; the free versions wait for the full lesson to be accepted", async () => {
  assert.equal(B.hasCreditForLesson({ remaining: 0, canScan: true }), false);
  assert.equal(B.hasCreditForLesson({ remaining: 3, canScan: false }), false);
  assert.equal(B.hasCreditForLesson({ remaining: 1, canScan: true }), true);
  const gen = planning.slice(planning.indexOf("async function generateAI("), planning.indexOf("\"Add question\" (Ricky"));
  assert.ok(gen.indexOf("if (quota && !hasCreditForLesson(quota))") < gen.indexOf("startGenerate("), "checked before anything is sent");
  // Refused: the free ones never run.
  let started = 0;
  const refused = await B.startGenerate(() => Promise.reject(Object.assign(new Error("no credits"), { reason: 402 })), [async () => (started++, "a"), async () => (started++, "b")]);
  assert.equal(started, 0, "a refused Generate starts no free version");
  assert.equal(refused[0].status, "rejected");
  // Accepted (the scan id arrives): they start at once, before the full lesson is back.
  let release;
  const order = [];
  const run = B.startGenerate((onAccepted) => new Promise((res) => {
    setTimeout(() => { order.push("accepted"); onAccepted(); }, 5);
    release = () => res("full");
  }), [async () => (order.push("flow"), "v1"), async () => (order.push("flow"), "v2")]);
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(order, ["accepted", "flow", "flow"], "side by side once accepted");
  release();
  const out = await run;
  assert.deepEqual(out.map((x) => x.value), ["full", "v1", "v2"]);
  // No scan id (a host that answers in one go): they start when it is back.
  const late = [];
  await B.startGenerate(async () => (late.push("full"), "f"), [async () => (late.push("flow"), "x")]);
  assert.deepEqual(late, ["full", "flow"]);
});

test("#200: a shutter press in auto mode gets Retake / Keep; auto-snap keeps its hint", () => {
  const capture = camera.slice(camera.indexOf("async function captureNow("), camera.indexOf("function keepBlurryShot()"));
  assert.match(capture, /async function captureNow\(by: "teacher" \| "auto" = "teacher"\)/);
  assert.match(capture, /if \(by === "auto"\) \{\s*flashBlurryHint\(\);\s*release\(res\.canvas\);\s*\} else setBlurryShot\(res\);/);
  assert.doesNotMatch(capture, /if \(autoRef\.current\) flashBlurryHint\(\);/, "auto MODE no longer decides; who pressed does");
  assert.match(camera, /shootRef\.current = autoShoot;/, "the auto-snap loop calls autoShoot");
  assert.match(camera, /function shoot\(\) \{\s*void captureNow\("teacher"\);/, "the shutter is the teacher's");
});
