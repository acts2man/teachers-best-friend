// RULE R5: grading one student or one answer group never changes anyone
// else's grade. docs/system-map.md, rule R5.
//
// Incident: 12 Oct 2026 (#126 round 3, Ricky's question 8). "Grade on their
// own" lived only in the browser; the pull-out was lost on save/reload, the
// student merged back into their old group once given the same credit,
// "Change" on that group re-graded them, and the green "Confirm N" bar
// confirmed them while their own credit form was open. Fixed by persisting
// StudentResponse.gradedAlone (20261013120000) and honouring it in
// groupAnswers / autoGradedToConfirm (lib/teacher-workflow.ts).
//
// Fuzzed over random class sets: every Grade-by-question action the UI takes
// (components/teacher-review.tsx: grade a group, grade one, pull out, confirm
// the bar) is applied through the real lib functions, and every response the
// action was not aimed at must come out byte-for-byte unchanged.
import test from "node:test";
import assert from "node:assert/strict";
import { bundle, rng, RUNS } from "./lib/bundle.mjs";

const W = bundle("lib/teacher-workflow.ts");

const ANSWERS = ["4", "-4", "5", "4.0", "", "x+1", "x + 1"];

function assessment(R) {
  const questions = Array.from({ length: R.int(1, 3) }, (_, i) => ({
    id: "q" + i, number: i + 1, text: "", passage: "", answer: "4", standard: "6.EE.1", secondary: "", skill: "", dok: 1,
    alignment: 100, confidence: 100, level: "On grade", reasoning: "", verified: true, excluded: false,
  }));
  const responses = [];
  const students = Array.from({ length: R.int(2, 14) }, (_, i) => "s" + i);
  for (const q of questions)
    for (const s of students) {
      const answer = R.pick(ANSWERS);
      const verdict = answer === "" ? "blank" : answer === "4" || answer === "4.0" ? R.pick(["match", "match", "unsure"]) : R.pick(["other", "unsure"]);
      const [r] = W.normalizeRecognizedResponses({ questions: [q] }, s, [{ questionId: q.id, answer, finalAnswer: answer, verdict }]);
      // Some already graded by the teacher, some at a shaky confidence.
      const graded = R.chance(0.3) ? { verified: true, match: R.pick([0, 50, 100]), correct: false } : {};
      if (graded.match === 100) graded.correct = true;
      responses.push({ ...r, id: q.id + "-" + s, confidence: R.chance(0.15) ? R.int(50, 89) : r.confidence, ...graded });
    }
  let a = {
    id: "a", classId: "c", title: "T", subject: "Math", grade: 6, framework: "California", createdAt: "", status: "Ready",
    questions, responses, uploadIds: [], source: "manual", targetStandards: [],
  };
  // Pull a few students out to be graded on their own.
  for (const r of responses) if (R.chance(0.15)) a = W.setGradedAlone(a, r.id, true);
  return a;
}

/** The responses an action changed, by id. */
function changed(before, after) {
  const was = new Map(before.responses.map((r) => [r.id, JSON.stringify(r)]));
  return after.responses.filter((r) => was.get(r.id) !== JSON.stringify(r)).map((r) => r.id);
}

const subset = (ids, allowed) => ids.filter((id) => !allowed.includes(id));

test(`grading a group changes only that group's answers, and never a pulled-out student (${RUNS} class sets)`, () => {
  for (let seed = 1; seed <= RUNS; seed++) {
    const R = rng(seed);
    const a = assessment(R);
    const alone = new Set(a.responses.filter((r) => r.gradedAlone).map((r) => r.id));
    for (const q of a.questions) {
      for (const g of W.groupAnswers(a, q.id)) {
        if (!g.alone) for (const id of g.responseIds) assert.ok(!alone.has(id), `seed ${seed}: pulled-out ${id} sits inside shared group ${g.answer}`);
        for (const credit of [0, 50, 100]) {
          const after = W.applyGroupScore(a, g.responseIds, credit, credit < 100 ? "computation" : undefined);
          const leaked = subset(changed(a, after), g.responseIds);
          assert.deepEqual(leaked, [], `seed ${seed}: grading group "${g.answer}" changed ${leaked}`);
        }
      }
    }
  }
});

test(`a pulled-out student stays on their own after any grade, and nothing done to a group reaches them (${RUNS} class sets)`, () => {
  for (let seed = 1; seed <= RUNS; seed++) {
    const R = rng(seed);
    let a = assessment(R);
    const pulled = a.responses.filter((r) => r.gradedAlone);
    for (const p of pulled) {
      // Grade them to the same credit their old group has -- the exact move
      // that merged them back on 12 Oct -- then grade every group again.
      const credit = R.pick([0, 50, 100]);
      a = W.applyGroupScore(a, [p.id], credit);
      for (const g of W.groupAnswers(a, p.questionId)) {
        if (g.responseIds.includes(p.id)) {
          assert.equal(g.alone, true, `seed ${seed}: ${p.id} merged into group "${g.answer}" after being graded`);
          assert.deepEqual(g.responseIds, [p.id]);
          continue;
        }
        const after = W.applyGroupScore(a, g.responseIds, R.pick([0, 50, 100]));
        assert.equal(JSON.stringify(after.responses.find((r) => r.id === p.id)), JSON.stringify(a.responses.find((r) => r.id === p.id)), `seed ${seed}: "Change" on "${g.answer}" re-graded pulled-out ${p.id}`);
      }
    }
  }
});

test("the green Confirm bar never confirms a pulled-out student, and confirms nothing but clean matches", () => {
  for (let seed = 1; seed <= RUNS; seed++) {
    const a = assessment(rng(seed));
    const bar = W.matchesToConfirm(a);
    const after = W.confirmResponses(a, bar);
    for (const id of changed(a, after)) {
      const r = a.responses.find((x) => x.id === id);
      assert.ok(!r.gradedAlone, `seed ${seed}: the bar confirmed pulled-out ${id}`);
      assert.ok(r.correct && r.confidence >= W.CLEAN_READ, `seed ${seed}: the bar confirmed ${id}, which is not a clean match`);
    }
  }
});

test("grading one student touches that student only", () => {
  for (let seed = 1; seed <= RUNS; seed++) {
    const R = rng(seed);
    const a = assessment(R);
    const r = R.pick(a.responses);
    const after = W.applyGroupScore(W.setGradedAlone(a, r.id, true), [r.id], R.pick([0, 50, 100]));
    assert.deepEqual(subset(changed(a, after), [r.id]), [], `seed ${seed}: grading ${r.id} changed someone else`);
  }
});

test("before gradedAlone was saved (#126), a pulled-out student merged back -- reproduced", () => {
  // The old flow kept the pull-out in browser state only; after a save and
  // reload the response carried no mark, which is this:
  const forget = (a) => ({
    ...a,
    responses: a.responses.map((r) => {
      const copy = { ...r };
      delete copy.gradedAlone;
      return copy;
    }),
  });
  let merged = false;
  for (let seed = 1; seed <= RUNS && !merged; seed++) {
    let a = assessment(rng(seed));
    for (const p of a.responses.filter((r) => r.gradedAlone)) {
      const peers = W.groupAnswers(a, p.questionId).find((g) => !g.alone && !g.unsure && g.verified && g.answer === W.answerKey(p.finalAnswer || p.answer));
      if (!peers) continue;
      a = W.applyGroupScore(a, [p.id], peers.match);
      const back = W.groupAnswers(forget(a), p.questionId).find((g) => g.responseIds.includes(p.id));
      if (back.responseIds.length > 1) merged = true;
    }
  }
  assert.ok(merged, "expected a forgotten pull-out to rejoin its old group");
});
