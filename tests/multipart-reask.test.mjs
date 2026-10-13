// PR 2, item 3: missing parts on multi-part questions.
//
// Reported (Ricky, "Exponential and Logarithmic Functions 2", question 2): 4 of 8
// answers read. The saved result shows the read keeping only the last two
// parts of that question's answer in finalAnswer ("y=4; (0,10/3)"), so every
// student who reached the asymptote and intercept grouped together whatever
// they wrote for the transformations.
//
// Ricky's idea, implemented: each question carries how many parts it asks for
// (Question.answerParts, set by the worksheet read, persisted by migration
// 20261012200000), grading is told that number, and a read that comes back with
// fewer is re-asked ONCE for that student and those questions; still short goes
// to Unsure -- never blank, never wrong. It is NOT inferred from ";" in the key:
// 19% of confirmed keys use ";" for notes ("x = 15/2; x = 5 is excluded").
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

const q = (id, number, answer, answerParts) => ({ id, number, text: "", passage: "", answer, ...(answerParts ? { answerParts } : {}), standard: "S", secondary: "", skill: "", dok: 1, alignment: 90, confidence: 90, level: "On grade", reasoning: "", verified: true, excluded: false });
const assessment = {
  id: "a", classId: "c", title: "t", subject: "Math", grade: 11, framework: "California", createdAt: "", status: "Ready", source: "ai",
  targetStandards: ["S"], answerKeyVerified: true, uploadIds: [], responses: [],
  questions: [
    q("q1", 1, "x = 2"),
    // Question 2's real key, from the assessment, with the parts the read says.
    q("q2", 2, "Shift right 1 unit, reflect across the x-axis, vertically stretch by factor 2, and shift up 4 units; horizontal asymptote y = 4; y-intercept (0,10/3)", 3),
  ],
};
// Two students, one page each, one request.
const batches = scan.planScanBatches([[0], [1]], ["p0", "p1"], 2);
const answer = (questionId, finalAnswer, verdict = "other") => ({ questionId, answer: finalAnswer, verdict, finalAnswer });

test("the question says how many parts: three for question 2, one for question 1", () => {
  assert.equal(payload.expectedParts(assessment.questions[0]), 1);
  assert.equal(payload.expectedParts(assessment.questions[1]), 3);
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

test("the worksheet read is asked for the number of parts (prompt version 5) and the read keeps it", () => {
  assert.equal(shared.READ_PROMPT_VERSION, 5);
  const w = { assessments: [], students: [], classes: [], customStandards: [], sharedStandards: [] };
  const catalog = [{ code: "S", title: "", grade: 11, framework: "California", subject: "Math" }];
  const p = shared.analyzeInput.parse({ mode: "assignment", text: "1. x", grade: 11, subject: "Math", framework: "California", targetStandards: ["S"] });
  const { task, schema } = shared.buildPrompt(p, w, catalog, false);
  assert.match(task, /For each question set parts to the number of separate answers/);
  assert.deepEqual(schema.properties.questions.items.properties.parts, { type: "integer", minimum: 1, maximum: 20 });
  // Tripwire: an unescaped quote in that sentence once ended the string early,
  // and JavaScript happily treated the rest of the prompt as dead statements --
  // the read lost its standards, alignment and DOK instructions, and nothing
  // else noticed. The built prompt must still reach its own last instructions.
  for (const tail of ["assign each question the best-matching standard", "Classify Webb DOK 1–4", "This assignment is for"])
    assert.ok(task.includes(tail), "the prompt still contains: " + tail);
  const read = { title: "t", questions: [1, 3].map((parts, i) => ({ number: i + 1, text: "q", passage: "", answer: "a", standard: "S", secondary: "", skill: "", dok: 1, costas: 1, alignment: 90, improvement: "", confidence: 90, level: "On grade", reasoning: "", parts })) };
  const out = shared.finalizeAnalysis(p, read, w, catalog);
  assert.equal(out.questions[0].answerParts, undefined, "one part is the default, not stored");
  assert.equal(out.questions[1].answerParts, 3);
  assert.equal("parts" in out.questions[1], false);
});

// The independent review ran these keys and found every correct student sent
// to Unsure under the first version, which read parts from ";".
for (const key of ["x = 15/2; x=5 is excluded", "Answers will vary; should mention the setting", "B; because the author says so", "x = 2; x ≠ 0"]) {
  test(`a key using ";" for a note does not demote correct answers: ${key}`, async () => {
    const a = { ...assessment, questions: [q("qn", 1, key)] };
    let n = 0;
    const graded = await scan.gradeInBatches(batches, async (batch) => (n++, { groups: batch.groups.map((_, i) => ({ group: i, responses: [answer("qn", key.split(";")[0].trim(), "match")] })) }), undefined, 0, [], 1, 2, undefined, a);
    assert.equal(n, 1, "no re-ask");
    for (const g of graded) assert.equal(g.responses[0].verdict, "match");
    const [saved] = workflow.normalizeRecognizedResponses(a, "s", graded[0].responses);
    assert.equal(saved.correct, true);
  });
}

test("the single-student path also sends a short multi-part read to Unsure", () => {
  const [r] = workflow.normalizeRecognizedResponses(assessment, "s", [answer("q2", "x=2; ?; y=4", "match")]).filter((x) => x.questionId === "q2");
  assert.equal(r.confidence, 0);
  assert.equal(r.correct, false);
});

test("a long multi-part final answer is cut, never a reason to reject the batch", () => {
  const w = { assessments: [assessment], students: [], classes: [], customStandards: [], sharedStandards: [] };
  const p = shared.analyzeInput.parse({ mode: "class_scan", uploadIds: ["p0"], pageGroups: [[0]], assessmentId: "a", grade: 11, subject: "Math", framework: "California", targetStandards: ["S"] });
  const long = "part; ".repeat(60);
  const out = shared.finalizeAnalysis(p, { groups: [{ group: 0, responses: [{ questionId: "q2", answer: long, verdict: "other", finalAnswer: long, region: { page: 0, x: 0, y: 0, width: 0, height: 0 }, errorType: "" }] }] }, w, []);
  assert.ok(out.groups[0].responses[0].finalAnswer.length <= 600);
});

// ---- #125 review, items 1f and 1g -----------------------------------------

test("1g. each student is re-asked only for the questions THEY were short on, and only those pairs are taken back", () => {
  const three = { ...assessment, questions: [q("q1", 1, "a; b", 2), q("q2", 2, "c; d", 2), q("q3", 3, "e; f", 2)] };
  const b = scan.planScanBatches([[0], [1], [2]], ["p0", "p1", "p2"], 3)[0];
  const shorts = [
    { group: 0, questionId: "q1", expected: 2, got: 1 },
    { group: 1, questionId: "q2", expected: 2, got: 1 },
    { group: 2, questionId: "q1", expected: 2, got: 1 },
  ];
  const reasks = scan.planPartsReask(b, shorts);
  // Students 0 and 2 share {q1}; student 1 is asked q2 alone.
  assert.equal(reasks.length, 2);
  const forQ1 = reasks.find((r) => r.onlyQuestionIds.join() === "q1");
  const forQ2 = reasks.find((r) => r.onlyQuestionIds.join() === "q2");
  assert.deepEqual(forQ1.groupIndexes, [0, 2]);
  assert.deepEqual(forQ2.groupIndexes, [1]);
  void three;

  // The q1 request answers q1 for both students AND (unasked) q2 for student 0:
  // only the asked pairs are absorbed.
  const best = new Map([
    [0, { group: 0, responses: [answer("q1", "a; ?"), answer("q2", "c; ?", "unsure")] }],
    [2, { group: 2, responses: [answer("q1", "a; ?")] }],
  ]);
  scan.absorbPartsReask(best, forQ1, [
    { group: 0, responses: [answer("q1", "a; b"), answer("q2", "c; d")] },
    { group: 1, responses: [answer("q1", "a; b")] },
  ]);
  assert.equal(best.get(0).responses.find((r) => r.questionId === "q1").finalAnswer, "a; b", "asked pair taken");
  assert.equal(best.get(0).responses.find((r) => r.questionId === "q2").finalAnswer, "c; ?", "unasked pair left alone");
  assert.equal(best.get(2).responses.find((r) => r.questionId === "q1").finalAnswer, "a; b");
});

test("1g. a re-ask never turns a short (Unsure-bound) answer into a blank", () => {
  const b = scan.planScanBatches([[0]], ["p0"], 1)[0];
  const [reask] = scan.planPartsReask(b, [{ group: 0, questionId: "q2", expected: 3, got: 1 }]);
  // Before: no answer at all for q2 in this student's result (left out).
  const best = new Map([[0, { group: 0, responses: [answer("q1", "2", "match")] }]]);
  scan.absorbPartsReask(best, reask, [{ group: 0, responses: [{ questionId: "q2", answer: "", verdict: "blank", finalAnswer: "" }] }]);
  assert.equal(best.get(0).responses.find((r) => r.questionId === "q2"), undefined, "the blank was not taken");
  // And with a short answer present, a blank does not replace it either.
  const best2 = new Map([[0, { group: 0, responses: [answer("q2", "Shift right; ?; ?")] }]]);
  scan.absorbPartsReask(best2, reask, [{ group: 0, responses: [{ questionId: "q2", answer: "", verdict: "blank", finalAnswer: "" }] }]);
  assert.equal(best2.get(0).responses[0].verdict, "other");
  // What is still short then goes to Unsure, never blank.
  scan.settleShortParts(best2, [0], assessment);
  assert.equal(best2.get(0).responses[0].verdict, "unsure");
});

test("1f. answerParts follows a key edit on a multi-part question, and is never inferred on a single one", () => {
  const multi = q("m", 1, "x=2; y=3", 2);
  const single = q("s", 2, "4");
  const edited = workflow.applyAnswerKey({ ...assessment, questions: [multi, single] }, { m: "x=2; y=3; z=1", s: "15/2; x = 5 is excluded" });
  assert.equal(edited.questions[0].answerParts, 3, "follows the key to 3 parts");
  assert.equal(edited.questions[1].answerParts, undefined, "a note after ';' does not make a question multi-part");
  const back = workflow.applyAnswerKey(edited, { m: "x=2" });
  assert.equal(back.questions[0].answerParts, undefined, "edited down to one answer: no longer multi-part");
  // An unchanged key leaves the count alone.
  const same = workflow.applyAnswerKey({ ...assessment, questions: [multi] }, { m: "x=2; y=3" });
  assert.equal(same.questions[0].answerParts, 2);
});
