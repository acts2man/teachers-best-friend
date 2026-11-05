// What a lesson costs (review of #199, blocker). Proven when:
//   - one Generate (Visual, Hands-on and Auditory, three requests side by
//     side) is 1 credit: only the full lesson is billable and charged; the
//     other two versions and "Add question" are not, and still pass the spend
//     gate like every model call;
//   - the billing page says so;
//   - if any of the three fails, the credit is asked back and the server
//     releases it only when a request of the same run really failed
//     (refund_lesson_generation; migration 20261105120000, NOT applied), and
//     the screen shows what came back and says whether the credit came back;
//   - a refusal for credit says so plainly, in lesson words, not "1 page";
//   - the full lesson has room for its two new sections, and a lesson cut off
//     says so in lesson words.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
const B = bundle("lib/lesson-billing.ts");
const L = bundle("lib/teacher-lessons.ts");
const route = readFileSync("app/api/analyze/route.ts", "utf8");
const poll = readFileSync("app/api/analyze/[scanId]/route.ts", "utf8");
const planning = readFileSync("components/teacher-planning.tsx", "utf8");

test("only the full lesson is billable; the other versions and Add question are free", () => {
  assert.equal(B.lessonPartIsFree({ mode: "lesson", lessonPart: "full" }), false);
  assert.equal(B.lessonPartIsFree({ mode: "lesson" }), false, "an older request with no part is the full lesson");
  assert.equal(B.lessonPartIsFree({ mode: "lesson", lessonPart: "flow" }), true);
  assert.equal(B.lessonPartIsFree({ mode: "lesson", lessonPart: "question" }), true);
  assert.equal(B.lessonPartIsFree({ mode: "assignment", lessonPart: "flow" }), false, "only lessons");
  assert.match(route, /const billable =\s*!adminCatalog && p\.mode !== "name_strip" && p\.mode !== "key_check" && !lessonPartIsFree\(p\);/);
  assert.match(route, /const charging = Boolean\(svc && scanId && !adminCatalog && chargesForMode\(p\.mode\) && !lessonPartIsFree\(p\)\);/);
  assert.match(poll, /if \(!chargesForMode\(p\.mode\) \|\| lessonPartIsFree\(p\)\) return;/, "the poll route never confirms or releases a free part");
});

test("free parts still pass the spend gate, before any scan is opened", () => {
  const gate = route.indexOf("await enforceSpendGate(gate, user);");
  const start = route.indexOf("scanId = await startScan(");
  assert.ok(gate > 0 && start > gate, "the gate runs first");
  const block = route.slice(route.lastIndexOf("if (svc) {", gate), gate);
  assert.doesNotMatch(block, /billable|lessonPart/, "the gate is not skipped for free requests");
});

test("all three requests of a Generate share one run id, and a failure asks the credit back", () => {
  const gen = planning.slice(planning.indexOf("async function generateAI("), planning.indexOf("\"Add question\" (Ricky"));
  assert.match(gen, /const lessonRun = crypto\.randomUUID\(\);/);
  assert.match(gen, /lessonPart: "full", lessonRun \}/);
  assert.match(gen, /lessonPart: "flow", lessonRun \}/);
  assert.match(gen, /const refunded = outcome\.missing\.length \? await refundLesson\(lessonRun\) : null;/);
  assert.match(gen, /full\.reason\.reason === 402\) \{\s*toast\.error\(OUT_OF_CREDITS_FOR_LESSON/);
  const refund = readFileSync("app/api/lessons/refund/route.ts", "utf8");
  assert.match(refund, /rpc\("refund_lesson_generation", \{\s*p_teacher: user,\s*p_run: parsed\.data\.lessonRun,/);
  assert.match(refund, /refunded: !error && Number\(data \?\? 0\) > 0/, "never claims a refund it did not make");
  const sql = readFileSync("supabase/migrations/20261105120000_refund_lesson_generation.sql", "utf8");
  assert.match(sql, /f\.params->>'lessonRun' = p_run\s+and f\.status = 'failed'/, "only when a request of the run failed");
  assert.match(sql, /coalesce\(s\.params->>'lessonPart', 'full'\) = 'full'/);
  assert.match(sql, /grant execute on function public\.refund_lesson_generation\(uuid, text\) to service_role;/);
  assert.match(readFileSync("supabase/checks/refund-lesson-generation.sql", "utf8"), /ROLLED_BACK expect failed_run=1 again=0 worked_run=0/);
});

const flow = (n) => ({ materials: ["m" + n], phases: [{ time: "0-5", name: "Start", text: "t" + n }] });
const full = { objective: "o", materials: ["m"], phases: [{ time: "0-5", name: "Start", text: "t" }], practice: [{ q: "q", a: "a" }], exit: [{ q: "e", a: "b" }] };

test("what came back is shown, and the message says whether the credit came back", () => {
  const all = L.generateOutcome("Visual", full, [["Kinesthetic", flow(1)], ["Auditory", flow(2)]]);
  assert.deepEqual(all.missing, []);
  assert.equal(L.generateMessage(all, null), "Your lesson plan is ready in Visual, Hands-on and Auditory. Review it, edit anything, then save it.");
  const oneFlow = L.generateOutcome("Visual", full, [["Kinesthetic", null], ["Auditory", flow(2)]]);
  assert.deepEqual(oneFlow.missing, ["Kinesthetic"]);
  assert.ok(oneFlow.lesson.flows.Auditory && !oneFlow.lesson.flows.Kinesthetic);
  assert.equal(L.generateMessage(oneFlow, true), "Your lesson plan is ready, but the Hands-on version didn’t come back. You weren’t charged for this Generate. Generate again to try once more.");
  assert.match(L.generateMessage(oneFlow, false), /The credit couldn’t be given back automatically — contact support and we will\./);
  // The full one failed: the two flows that came back are kept, not thrown away.
  const noFull = L.generateOutcome("Visual", null, [["Kinesthetic", flow(1)], ["Auditory", flow(2)]]);
  assert.deepEqual(noFull.missing, ["Visual"]);
  assert.deepEqual(Object.keys(noFull.lesson.flows).sort(), ["Auditory", "Kinesthetic"]);
  assert.deepEqual(noFull.lesson.practice, []);
  assert.match(L.generateMessage(noFull, true), /^The Visual version didn’t come back, and the practice and exit ticket come with the first one — they are empty below\. Use Add question, or generate again\. You weren’t charged/);
  // The screen copes with a lesson with no practice yet (it crashed on
  // content.practice[0].q -- caught by scripts/browser-check/lesson-billing.mjs).
  assert.match(planning, /\{content\.practice\[0\] && \(\s*<div className="practice-prompt">/);
  const none = L.generateOutcome("Visual", null, [["Kinesthetic", null], ["Auditory", null]]);
  assert.equal(none.lesson, null);
  assert.match(L.generateMessage(none, true), /none of the three versions came back\. You weren’t charged for this Generate\./);
});

test("a refusal for credit is said in lesson words", () => {
  assert.match(B.OUT_OF_CREDITS_FOR_LESSON, /^Generating a lesson uses 1 credit, and you have none left this period/);
  assert.doesNotMatch(B.OUT_OF_CREDITS_FOR_LESSON, /page/);
});

test("the billing page says what a lesson costs", () => {
  const billing = readFileSync("components/teacher-billing.tsx", "utf8").replace(/\s+/g, " ");
  assert.match(billing, /Generating a lesson plan is 1 credit, and that covers all three versions \(Visual, Hands-on and Auditory\); adding a question to it is free\./);
});

test("the full lesson has room for its new sections; a cut-off lesson says so", () => {
  assert.equal(B.lessonOutputCeiling({ mode: "lesson", lessonPart: "full" }, 6000), B.LESSON_FULL_MIN_OUTPUT);
  assert.equal(B.lessonOutputCeiling({ mode: "lesson" }, 6000), B.LESSON_FULL_MIN_OUTPUT);
  assert.equal(B.lessonOutputCeiling({ mode: "lesson", lessonPart: "full" }, 20000), 20000, "never lowers a higher configured limit");
  assert.equal(B.lessonOutputCeiling({ mode: "lesson", lessonPart: "flow" }, 6000), 6000);
  assert.equal(B.lessonOutputCeiling({ mode: "class_scan" }, 32000), 32000);
  assert.ok(B.LESSON_FULL_MIN_OUTPUT >= 2 * 6000, "twice the old ceiling: the largest of 16 recorded lessons used 1,516");
  assert.match(route, /const settings = \{ \.\.\.configured, maxOutput: lessonOutputCeiling\(p, configured\.maxOutput\) \};/);
  assert.match(B.incompleteMessage("lesson"), /^This lesson came out longer than the AI can write in one go, so it was cut off\. Nothing was charged/);
  assert.equal(B.incompleteMessage("class_scan"), "This document needs a smaller batch. Try fewer pages.");
  assert.match(route, /throw new HttpError\(422, incompleteMessage\(p\.mode\)\);/);
  assert.match(poll, /\? incompleteMessage\(p\.mode\)/);
});
