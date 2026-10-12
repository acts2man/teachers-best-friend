// PR 2, item 3: missing parts on multi-part questions.
//
// Reported (Ricky, "Exponential and Logarithmic Functions 2", question 2): 4 of 8
// answers read. The saved result shows the read keeping only the last two
// parts of that question's answer in finalAnswer ("y=4; (0,10/3)"), so every
// student who reached the asymptote and intercept grouped together whatever
// they wrote for the transformations.
//
// Ricky's idea, implemented: the confirmed key says how many parts a question
// has ("; "-separated), grading is told that number, and a read that comes back
// with fewer is re-asked ONCE for that student and those questions; still short
// goes to Unsure -- never blank, never wrong.
//
// Proven when (this file): a short read re-asks once and then falls back to
// Unsure. The other half -- the replay reading all parts for every student on
// that question -- needs the deployed replay and has not run.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";

const require = createRequire(import.meta.url);
function bundle(entry) {
  const r = buildSync({
    entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false,
    external: ["pdfjs-dist/legacy/build/pdf.mjs"],
    alias: { "server-only": path.join(process.cwd(), "tests/fixtures/empty-module.cjs") },
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}
const scan = bundle("lib/teacher-class-scan.ts");
const payload = bundle("lib/prompt-payload.ts");
const workflow = bundle("lib/teacher-workflow.ts");
const shared = bundle("lib/analyze-shared.ts");

const q = (id, number, answer) => ({ id, number, text: "", passage: "", answer, standard: "S", secondary: "", skill: "", dok: 1, alignment: 90, confidence: 90, level: "On grade", reasoning: "", verified: true, excluded: false });
const assessment = {
  id: "a", classId: "c", title: "t", subject: "Math", grade: 11, framework: "California", createdAt: "", status: "Ready", source: "ai",
  targetStandards: ["S"], answerKeyVerified: true, uploadIds: [], responses: [],
  questions: [
    q("q1", 1, "x = 2"),
    // Question 2's real key, from the assessment: three parts.
    q("q2", 2, "Shift right 1 unit, reflect across the x-axis, vertically stretch by factor 2, and shift up 4 units; horizontal asymptote y = 4; y-intercept (0,10/3)"),
  ],
};
// Two students, one page each, one request.
const batches = scan.planScanBatches([[0], [1]], ["p0", "p1"], 2);
const answer = (questionId, finalAnswer, verdict = "other") => ({ questionId, answer: finalAnswer, verdict, finalAnswer });

test("the key says how many parts: three for question 2, one for question 1", () => {
  assert.equal(payload.expectedParts(assessment.questions[0].answer), 1);
  assert.equal(payload.expectedParts(assessment.questions[1].answer), 3);
  const sent = payload.questionsForGrading(assessment);
  assert.equal(sent[1].parts, 3);
  assert.equal("parts" in sent[0], false, "single-part questions are sent exactly as before");
});

test("a short read is re-asked once, for that student and that question only, then goes to Unsure", async () => {
  const calls = [];
  const graded = await scan.gradeInBatches(
    batches,
    async (batch) => {
      calls.push(batch);
      // Student 0 always comes back with 2 of 3 parts on question 2.
      return { groups: batch.groups.map((_, i) => ({ group: i, responses: [answer("q1", "2", "match"), answer("q2", batch.groupIndexes[i] === 0 ? "y=4; (0,10/3)" : "right 1, reflect, stretch 2, up 4; y=4; (0,10/3)")].filter((r) => !batch.onlyQuestionIds?.length || batch.onlyQuestionIds.includes(r.questionId)) })) };
    },
    undefined, 0, [], 2, 2, undefined, assessment,
  );
  assert.equal(calls.length, 2, "the batch, then exactly one re-ask");
  assert.deepEqual(calls[1].onlyQuestionIds, ["q2"]);
  assert.deepEqual(calls[1].uploadIds, ["p0"], "only the short student's page");
  const g0 = graded.find((g) => g.group === 0);
  const g1 = graded.find((g) => g.group === 1);
  assert.equal(g0.responses.find((r) => r.questionId === "q2").verdict, "unsure");
  assert.equal(g1.responses.find((r) => r.questionId === "q2").verdict, "other", "a complete read is untouched");
  // What the app would save: Unsure (confidence 0), the parts that were read
  // kept for the teacher -- not blank, not marked.
  const [saved] = workflow.normalizeRecognizedResponses(assessment, "s0", g0.responses).filter((r) => r.questionId === "q2");
  assert.equal(saved.confidence, 0);
  assert.equal(saved.correct, false);
  assert.notEqual(saved.match, 0, "not scored as blank");
  assert.equal(saved.finalAnswer, "y=4; (0,10/3)");
  // And Grade by question puts it in the Unsure group.
  const groups = workflow.groupAnswers({ ...assessment, responses: [{ ...saved, id: "r" }] }, "q2");
  assert.equal(groups[0].unsure, true);
});

test("a re-ask that finds every part is taken, and nothing goes to Unsure", async () => {
  let n = 0;
  const graded = await scan.gradeInBatches(
    batches,
    async (batch) => {
      n++;
      const full = n > 1;
      return { groups: batch.groups.map((_, i) => ({ group: i, responses: [answer("q1", "2", "match"), answer("q2", full || batch.groupIndexes[i] === 1 ? "right 1, reflect, stretch 2, up 4; y=4; (0,10/3)" : "y=4")].filter((r) => !batch.onlyQuestionIds?.length || batch.onlyQuestionIds.includes(r.questionId)) })) };
    },
    undefined, 0, [], 2, 2, undefined, assessment,
  );
  assert.equal(n, 2);
  const r = graded.find((g) => g.group === 0).responses.find((x) => x.questionId === "q2");
  assert.equal(r.verdict, "other");
  assert.equal(payload.partsRead(r.finalAnswer), 3);
});

test("a re-ask that fails does not lose the batch; the short answer goes to Unsure", async () => {
  let n = 0;
  const graded = await scan.gradeInBatches(
    batches,
    async (batch) => {
      n++;
      if (n > 1) throw new Error("network");
      return { groups: batch.groups.map((_, i) => ({ group: i, responses: [answer("q1", "2", "match"), answer("q2", "y=4; ?; (0,10/3)", "match")] })) };
    },
    undefined, 0, [], 2, 2, undefined, assessment,
  );
  assert.equal(graded.length, 2, "both students kept");
  for (const g of graded) assert.equal(g.responses.find((x) => x.questionId === "q2").verdict, "unsure", "a '?' part is a part not read, even under a 'match'");
});

test("nothing multi-part, nothing re-asked", async () => {
  const single = { ...assessment, questions: [assessment.questions[0]] };
  let n = 0;
  await scan.gradeInBatches(batches, async (batch) => (n++, { groups: batch.groups.map((_, i) => ({ group: i, responses: [answer("q1", "2", "match")] })) }), undefined, 0, [], 1, 2, undefined, single);
  assert.equal(n, 1);
});

test("the grading prompt carries the parts rule only when a question has parts, and the re-ask names only its questions", () => {
  const w = { assessments: [assessment], students: [], classes: [], customStandards: [], sharedStandards: [] };
  const p = (extra) => shared.analyzeInput.parse({ mode: "class_scan", uploadIds: ["p0"], pageGroups: [[0]], assessmentId: "a", grade: 11, subject: "Math", framework: "California", targetStandards: ["S"], ...extra });
  const full = shared.buildPrompt(p({}), w, [], true).task;
  assert.match(full, /"parts": N expects N separate answers/);
  assert.doesNotMatch(full, /second look/);
  const reask = shared.buildPrompt(p({ onlyQuestionIds: ["q2"] }), w, [], true).task;
  assert.match(reask, /second look at only the questions listed below/);
  assert.doesNotMatch(reask, /"id":"q1"/, "question 1 is not asked again");
  const single = { ...assessment, questions: [assessment.questions[0]] };
  assert.doesNotMatch(shared.buildPrompt(p({}), { ...w, assessments: [single] }, [], true).task, /separate answers/);
});

test("the worksheet read writes multi-part keys with '; ' (prompt version 5)", () => {
  assert.equal(shared.READ_PROMPT_VERSION, 5);
  const w = { assessments: [], students: [], classes: [], customStandards: [], sharedStandards: [] };
  const catalog = [{ code: "S", title: "", grade: 11, framework: "California", subject: "Math" }];
  const task = shared.buildPrompt(shared.analyzeInput.parse({ mode: "assignment", text: "1. x", grade: 11, subject: "Math", framework: "California", targetStandards: ["S"] }), w, catalog, false).task;
  assert.match(task, /write its answer key as those answers in order separated by "; "/);
  // Tripwire: an unescaped quote in that sentence once ended the string early,
  // and JavaScript happily treated the rest of the prompt as dead statements --
  // the read lost its standards, alignment and DOK instructions, and nothing
  // else noticed. The built prompt must still reach its own last instructions.
  for (const tail of ["assign each question the best-matching standard", "Classify Webb DOK 1–4", "This assignment is for"])
    assert.ok(task.includes(tail), "the prompt still contains: " + tail);
});
