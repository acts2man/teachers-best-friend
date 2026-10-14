// Re-reading a test that already has graded answers clears them. On 13 Oct a
// pilot teacher re-read a test and its 10 graded answers went without a word.
// Every re-read now asks first, saying how many grades go; with nothing graded
// it reads straight away. Driven end to end in
// scripts/browser-check/reread-confirm.mjs; these pin the count, the wording,
// and that each of the three buttons goes through the step.
import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { readFileSync } from "node:fs";
function bundle(path){const result=buildSync({entryPoints:[path],bundle:true,platform:"node",format:"cjs",write:false});const shim={exports:{}};new Function("module","exports",result.outputFiles[0].text)(shim,shim.exports);return shim.exports}
const { gradesClearedByReread, rereadWarning } = bundle("lib/teacher-workflow.ts");

const resp = (studentId, questionId, verified) => ({ id: studentId + questionId, studentId, questionId, answer: "1", correct: true, match: 100, misconception: "", confidence: 99, verified });

const q = (id) => ({ id });

test("counts the graded answers, the students they belong to, and how many the teacher confirmed", () => {
  const a = { questions: [q("q1"), q("q2")], responses: [resp("s1", "q1", true), resp("s1", "q2", true), resp("s2", "q1", false)] };
  assert.deepEqual(gradesClearedByReread(a), { answers: 3, students: 2, confirmed: 2, writing: false });
});

test("rows for questions the test no longer has are not counted", () => {
  const a = { questions: [q("q1")], responses: [resp("s1", "q1", true), resp("s1", "gone", true)] };
  assert.equal(gradesClearedByReread(a).answers, 1);
});

test("nothing graded, nothing to warn about", () => {
  assert.deepEqual(gradesClearedByReread({ questions: [], responses: [] }), { answers: 0, students: 0, confirmed: 0, writing: false });
  assert.deepEqual(gradesClearedByReread(undefined), { answers: 0, students: 0, confirmed: 0, writing: false });
});

test("a writing assessment counts its rubric scores and says essays", () => {
  const a = { elaArea: "writing", genre: "narrative", grade: 4, questions: [], rubric: [{ id: "t1", name: "Ideas", max: 4, descriptor: "", standard: "" }, { id: "t2", name: "Conventions", max: 4, descriptor: "", standard: "" }], responses: [resp("s1", "t1", true), resp("s1", "t2", false), resp("s2", "t1", false)] };
  const risk = gradesClearedByReread(a);
  assert.equal(risk.writing, true);
  assert.equal(risk.answers, 3, "rubric scores are counted");
  assert.equal(risk.students, 2);
  const text = rereadWarning(risk, "save");
  assert.match(text.title, /^Clear the essay scores for \d+ students?\?$/);
  assert.match(text.body, /^Saving this replaces the writing assessment and its rubric/);
  assert.equal(text.go, "Clear grades and save");
  assert.doesNotMatch(text.body, /confirmed by you/, "no rubric-row count beside a student count");
});

test("the confirm step states the number of grades that will be cleared, and what else goes", () => {
  const ten = rereadWarning({ answers: 10, students: 4, confirmed: 10, writing: false });
  assert.equal(ten.title, "Clear 10 graded answers?");
  assert.match(ten.body, /the 10 graded answers from 4 students \(10 confirmed by you\) will be cleared, along with what they added to those students' standards progress/);
  assert.equal(ten.keep, "Keep my grades");
  assert.equal(ten.go, "Clear grades and read again");
  const one = rereadWarning({ answers: 1, students: 1, confirmed: 0, writing: false }, "save");
  assert.equal(one.title, "Clear 1 graded answer?");
  assert.match(one.body, /^Saving this revision replaces the test's questions, so the 1 graded answer from 1 student will be cleared/);
});

// Every button that runs something which clears grades must go through the
// step. Rather than pin exact source, find each onClick that calls one of
// those actions and require the gate in the same handler.
const DESTRUCTIVE = {
  "components/teacher-assessments.tsx": [/readDocument\(/],
  "components/teacher-scan.tsx": [/saveManual\b/, /createWriting\b/, /analyze\(undefined, true, true\)/],
};
test("every button that would clear grades goes through the confirm step", () => {
  for (const [file, actions] of Object.entries(DESTRUCTIVE)) {
    const src = readFileSync(file, "utf8");
    const handlers = [...src.matchAll(/onClick=\{([\s\S]*?)\}\s*\n?\s*>/g)].map((m) => m[1]);
    let seen = 0;
    for (const h of handlers) {
      if (!actions.some((re) => re.test(h))) continue;
      seen++;
      assert.match(h, /gradesClearedByReread\(a\)\.answers > 0|clearsGrades/, `${file}: ungated handler: ${h.trim().slice(0, 120)}`);
    }
    assert.ok(seen >= (file.includes("scan") ? 3 : 2), `${file}: found ${seen} gated buttons`);
  }
});
