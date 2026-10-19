// Michael, 19 Oct 2026: his Story Organizer -- nine boxes the AI scored 82 to
// 96 -- showed "Standards alignment 38%". alignment() counted every question
// tagged to a standard outside the assessment's target standards as 0, and
// five boxes were tagged W.4.3, which is not in his list: (82+84+86+90)/9 = 38.
//
// Now the summary averages each question's own alignment (90%), and the
// off-list questions are said separately: "5 of 9 questions use standards
// outside your list". Made-up assessment; real standard codes only.
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
const { alignment, offListQuestions } = bundle("lib/teacher-data.ts");

const q = (n, alignment, standard) => ({ id: "q" + n, number: n, text: "", passage: "", answer: "", standard, secondary: "", skill: "", dok: 2, alignment, confidence: 90, level: "", reasoning: "", verified: true, excluded: false });
// Four boxes on his list (one of them the 90 on RL.4.2), five on W.4.3.
const organizer = {
  targetStandards: ["RL.4.1", "RL.4.2", "RL.4.3"],
  questions: [q(1, 82, "RL.4.3"), q(2, 84, "RL.4.3"), q(3, 86, "RL.4.1"), q(4, 90, "RL.4.2"),
    q(5, 96, "W.4.3"), q(6, 95, "W.4.3"), q(7, 96, "W.4.3"), q(8, 92, "W.4.3"), q(9, 90, "W.4.3")],
};

test("Michael's Story Organizer: the summary is the questions' own average, 90%, not 38%", () => {
  assert.equal(alignment(organizer), 90);
});

test("the off-list questions are counted separately: 5 of 9", () => {
  assert.deepEqual(offListQuestions(organizer), { n: 5, m: 9 });
  assert.deepEqual(offListQuestions({ ...organizer, targetStandards: [...organizer.targetStandards, "W.4.3"] }), { n: 0, m: 9 });
  assert.deepEqual(offListQuestions({ ...organizer, targetStandards: [] }), { n: 0, m: 9 }, "no list: nothing is outside it");
  // An excluded question is not one of the assessment's questions here.
  const excluded = { ...organizer, questions: organizer.questions.map((x, i) => (i === 8 ? { ...x, excluded: true } : x)) };
  assert.deepEqual(offListQuestions(excluded), { n: 4, m: 8 });
});

test("the assessment shows the line only when some questions are off the list", () => {
  const src = readFileSync("components/teacher-assessments.tsx", "utf8");
  assert.match(src, /offListQuestions\(a\)/);
  assert.match(src, /questions use standards outside your list/);
  assert.match(src, /offList\.n > 0/);
});
