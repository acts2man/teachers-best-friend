// The answer key the app works out itself, and the second solve that checks
// it. Ricky's Algebra 2 test (7 Oct): six reads of the same worksheet each got
// 2-5 of 15 answers wrong, in different places -- and a wrong key grades the
// whole class wrong. bench/rational-expressions-2026-10-07.json is that data.
import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
function bundle(p) {
  const r = buildSync({
    entryPoints: [p], bundle: true, platform: "node", format: "cjs", write: false,
    alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
  });
  const shim = { exports: {} };
  new Function("module", "exports", r.outputFiles[0].text)(shim, shim.exports);
  return shim.exports;
}
const { compareAnswers, finalAnswer } = bundle("lib/math-answer.ts");
const K = bundle("lib/key-check.ts");
const { buildPrompt, analyzeInput } = bundle("lib/analyze-shared.ts");

const same = (a, b) => assert.equal(compareAnswers(a, b), "same", `${a}  vs  ${b}`);
const diff = (a, b) => assert.equal(compareAnswers(a, b), "different", `${a}  vs  ${b}`);

test("a sign is never ignored", () => {
  // Q5 on Ricky's scan: the key and the student's answer differ only in a sign.
  diff("2x/(x² − 4)", "2x/(x² + 4)");
  diff("x = -4", "x = 4");
  diff("−4", "4");
  diff("-5/(x+4)", "5/(x+4)");
  diff("x - 2", "x + 2");
});

test("Ricky's three wrong answers are caught as different", () => {
  diff("5/x", "5");
  diff("5/x", "5/(x+2)");
  diff("x = -4", "x = 4");
  diff("x = 15/2", "x = 15/4");
  diff("x = 15/2", "x = 7");
});

test("the same value written differently is the same answer", () => {
  same("15/2", "7.5");
  same("x = 15/2", "x=15/2=7.5");
  same("2x/(x²−4)", "2x/((x-2)(x+2))");
  same("2(x + 2)/(x(x + 1))", "(2x+4)/(x(x+1))");
  same("3x/[2(x − 3)]", "3x/2(x−3)");
  same("−5/(x + 4)", "-5/(x+4)");
  same("x²", "x^2");
});

test("domain notes and commentary are not part of the answer", () => {
  same("5/(x+2), with x ≠ 0, −2", "5/(x+2)");
  same("x = 15, with x ≠ 5; no extraneous solution", "15");
  same("x = 2, x = 0 is extraneous", "x = 2");
  same("8/x, x ≠ 0.", "8/x");
  assert.equal(finalAnswer("x = −4, no extraneous solution"), "-4");
});

test("two different equations never collapse into the same number", () => {
  diff("2x + 3y = 6", "x + y = 6");
  same("y = 2x + 1", "y=1+2x");
});

test("text answers compare as text, sign and all", () => {
  same("B", "b");
  diff("B", "C");
  diff("increase", "decrease");
});

const question = (id, number, answer, extra = {}) => ({
  id, number, text: "Simplify " + number, passage: "", answer, standard: "A-APR.6",
  secondary: "", skill: "", dok: 2, alignment: 90, confidence: 90, level: "On grade",
  reasoning: "", verified: true, excluded: false, ...extra,
});
const generated = (questions, over = {}) => ({
  id: "a1", classId: "c1", title: "Rational Expressions", subject: "Math", grade: 11,
  framework: "California", createdAt: "", status: "Ready", source: "ai",
  questions, responses: [], uploadIds: [], assignmentUploadIds: ["w1"], targetStandards: ["A-APR.6"],
  answerKeyUploadIds: [], ...over,
});

test("a key the app worked out is checked; a teacher's key is not", () => {
  const a = generated([question("q9", 9, "5"), question("q12", 12, "x = -4")]);
  assert.equal(K.keyIsGenerated(a), true);
  assert.equal(K.questionsToCheck(a).length, 2);
  assert.equal(K.keyIsGenerated({ ...a, answerKeyUploadIds: ["key1"] }), false);
  assert.equal(K.questionsToCheck({ ...a, answerKeyVerified: true }).length, 0, "an old, confirmed key is left alone");
});

test("a disagreement is flagged for the teacher; an agreement is marked checked", () => {
  const a = generated([question("q9", 9, "5"), question("q12", 12, "x = -4"), question("q15", 15, "15/2")]);
  const next = K.applyKeyCheck(a, [
    { questionId: "q9", answer: "5/x" },
    { questionId: "q12", answer: "x = −4" },
    { questionId: "q15", answer: "" },
  ]);
  const by = Object.fromEntries(next.questions.map((q) => [q.id, q.keyCheck]));
  assert.deepEqual(by.q9, { answer: "5/x", status: "differs" });
  assert.equal(by.q12.status, "agrees");
  assert.equal(by.q15, undefined, "a question the checker could not answer stays unchecked, not 'agrees'");
  assert.deepEqual(K.openDisagreements(next).map((q) => q.id), ["q9"]);
  const settled = K.settleDisagreements(next);
  assert.equal(K.openDisagreements(settled).length, 0);
  assert.equal(settled.questions.find((q) => q.id === "q9").keyCheck.status, "resolved");
});

test("the checker solves on its own: it is never shown the first answers", () => {
  const a = generated([question("q9", 9, "THE-FIRST-ANSWER-5"), question("q12", 12, "THE-FIRST-ANSWER-12")]);
  const ws = { assessments: [a], students: [{ id: "s1", classId: "c1", name: "Maria Gonzalez" }], classes: [], lessons: [] };
  const task = buildPrompt(analyzeInput.parse({ mode: "key_check", assessmentId: "a1", grade: 11, subject: "Math" }), ws, [], true).task;
  assert.ok(!task.includes("THE-FIRST-ANSWER"), "the generated answers reached the checker");
  assert.ok(task.includes("Simplify 9"), "the questions did");
  assert.ok(!task.includes("Maria"), "no student name");
  assert.match(task, /keep every negative sign/);
});

test("the check is free to the teacher, like the name pass", () => {
  const ledger = readFileSync("lib/page-ledger.ts", "utf8");
  assert.match(ledger, /FREE_MODES = new Set<Mode>\(\["name_strip", "catalog", "key_check"\]\)/);
  const route = readFileSync("app/api/analyze/route.ts", "utf8");
  assert.match(route, /p\.mode !== "key_check"/, "not billable, so create_scan charges nothing");
  const sql = readFileSync("supabase/migrations/20261008180000_answer_key_check.sql", "utf8");
  assert.match(sql, /'key_check',\s*'gpt-5\.6-luna',\s*'medium'/);
});

test("the key screen says the key is the app's, offers the teacher's own, and waits on disagreements", () => {
  const ui = readFileSync("components/teacher-answer-key.tsx", "utf8");
  assert.match(ui, /The app worked out these answers from the worksheet\./);
  assert.match(ui, /Upload my own key/);
  assert.match(ui, /Photograph my key/);
  assert.match(ui, /unsettled\.length > 0/, "confirming waits until disagreements are settled");
  assert.match(ui, /className="math-keys"/, "math symbols can be typed with a tap");
  assert.match(ui, /uploadIds: a\.assignmentUploadIds \?\? \[\]/, "only the blank worksheet goes to the checker, never student pages");
});

test("the stored reads replay to the numbers in the report", () => {
  const data = JSON.parse(readFileSync("bench/rational-expressions-2026-10-07.json", "utf8"));
  let right = 0, total = 0;
  for (const run of data.runs)
    for (const [n, t] of Object.entries(data.truth)) {
      total++;
      if (run.keys[n] !== undefined && compareAnswers(run.keys[n], t) === "same") right++;
    }
  assert.equal(total, 90);
  assert.equal(right, 69);
});
