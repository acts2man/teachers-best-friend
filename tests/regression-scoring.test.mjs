// The replay scorer measures whether the AI got an answer right, not whether
// it spelled it like the teacher (lib/regression/compare-answers.ts, used by
// lib/regression/score.ts).
//
// The first real run (13 Oct) scored a key 4/10 and reading 22/30 when a hand
// review found the AI right far more often. The four key pairs marked
// "reviewed" are the exact pairs from that review, as given in the task;
// every other value here is made up (rule R8), one for each way a right
// answer was failed and each way the scorer must still say "wrong".
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildSync } from "esbuild";

const ROOT = process.cwd();
function bundle(entry) {
  const r = buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    absWorkingDir: ROOT,
    alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, () => ({}));
  return m.exports;
}
const { judgeAnswer, partFinal, unitsIn, isProse } = bundle("lib/regression/compare-answers.ts");
const score = bundle("lib/regression/score.ts");

const resp = (studentId, questionId, o) => ({
  id: studentId + questionId, studentId, questionId, answer: "", correct: false, misconception: "", confidence: 100, verified: false, ...o,
});
const want = (studentId, questionId, finalAnswer, match) => ({ studentId, questionId, finalAnswer, answer: finalAnswer, match, verified: true });
const same = (a, b) => assert.equal(judgeAnswer(a, b), "same", `${a}  vs  ${b}`);
const diff = (a, b) => assert.equal(judgeAnswer(a, b), "different", `${a}  vs  ${b}`);

// ------------------------------------------------------------------ the reviewed key pairs
test("answer key: the reviewed equivalent pairs all score as right", () => {
  same("x=79", "x = 79"); // reviewed
  same("x=(ln 7)/2", "x = ln(7)/2"); // reviewed
  same("x=−1+2√3", "x = -1 + 2√3"); // reviewed
});

test("answer key: a cent off is wrong -- $3,577.55 against $3,577.56 (no rounding tolerance)", () => {
  diff("$3,577.55", "$3,577.56"); // reviewed
  diff("A(8)=1200(1.02)^8≈$1,406.00", "A(8) = $1,405.99");
  same("A(8)=1200(1.02)^8≈$1,405.99", "A(8) = $1,405.99");
});

test("answer key: working in the wrong unit is wrong even when the final number agrees", () => {
  diff("t=2log_2(10) years; t≈6.64 hours", "t = 2log_2(10) hours ≈ 6.64 hours");
  same("t=2log_2(10) hours; t≈6.64 hours", "t = 2log_2(10) hours ≈ 6.64 hours");
});

test("answer key: a description in different words is not a miss -- it needs a human check", () => {
  const read = "Sketch a rising curve through (0,1) and (1,3); the domain is all real numbers and it never touches the x-axis";
  const key = "Increasing curve that passes through (0,1) and (1,3); domain all reals; horizontal asymptote along the x-axis";
  assert.equal(judgeAnswer(read, key), "needs_human_check");
});

test("answer key score: 2 descriptions for a human check and 2 real misses is 8/10, misses named", () => {
  const key = [
    "Graph rises steadily through the origin and keeps climbing to the right",
    "Shift left two units, then reflect across the axis and stretch it",
    "x = 2", "x = ln(7)/2", "x = 79", "x = -1 + 2√3", "P(t) = 50e^(0.1t); P(3) = 50e^(3/10) = 67.49 birds",
    "12.5 years", "$3,577.56", "t = 2log_2(10) hours ≈ 6.64 hours",
  ];
  const read = [
    "The curve goes up through the origin and continues increasing as x grows larger",
    "Move the graph two units left; flip it over the axis; vertically stretch the result",
    "x=2", "x=(ln 7)/2", "x=79", "x=−1+2√3", "A(t)=50e^(0.1t); A(3)=50e^0.3≈67.49 birds",
    "t=ln(2)/0.0555≈12.5 years", "$3,577.55", "t=2log_2(10) years; t≈6.64 hours",
  ];
  const s = score.scoreKey(key.map((answer, i) => ({ number: i + 1, answer })), read.map((answer, i) => ({ number: i + 1, answer })));
  assert.equal(s.right, 6, "Q3-Q8 confirmed by value");
  assert.deepEqual(s.needsHumanCheck.map((x) => x.number), [1, 2]);
  assert.deepEqual(s.wrong, [9, 10], "the real misses");
  assert.equal(s.accuracy, 0.8, "8/10 not wrong");
  assert.equal(s.passed, false, "80% is under the 95% pass mark");
});

test("answer key score: a key answer missing a part is listed apart, not counted as confirmed", () => {
  const s = score.scoreKey([{ number: 1, answer: "y=-1; (0,7/2)" }], [{ number: 1, answer: "(0,7/2)" }]);
  assert.equal(s.right, 0);
  assert.deepEqual(s.partsMissing.map((x) => x.number), [1]);
  assert.deepEqual(s.wrong, []);
});

test("answer key score: a key answer missing a part counts AGAINST the pass mark", () => {
  // The app would grade every student against that incomplete key, so it is
  // as bad as a wrong one for the pass -- still listed apart, not as wrong.
  const s = score.scoreKey([{ number: 1, answer: "y=-1; (0,7/2)" }], [{ number: 1, answer: "(0,7/2)" }]);
  assert.equal(s.accuracy, 0);
  assert.equal(s.passed, false);
  const ten = score.scoreKey(
    Array.from({ length: 10 }, (_, i) => ({ number: i + 1, answer: i === 0 ? "y=-1; (0,7/2)" : String(i + 1) })),
    Array.from({ length: 10 }, (_, i) => ({ number: i + 1, answer: i === 0 ? "(0,7/2)" : String(i + 1) })),
  );
  assert.equal(ten.accuracy, 0.9, "9 of 10 count toward the pass");
  assert.deepEqual(ten.wrong, [], "and it is not listed as wrong");
  assert.deepEqual(ten.partsMissing.map((x) => x.number), [1]);
});

// ------------------------------------------------------------------ normalisation
test("labels, Unicode minus, thousands separators and chains are normalised away", () => {
  assert.equal(partFinal("domain=(-∞,∞)"), "(-∞,∞)");
  assert.equal(partFinal("asymptote=y=-3"), "-3");
  assert.equal(partFinal("y-intercept: (0,7/2)"), "(0,7/2)");
  assert.equal(partFinal("horizontal asymptote: y=-1"), "-1");
  assert.equal(partFinal("P=2,406,118.05"), "2406118.05");
  assert.equal(partFinal("B(3)=500e^0.6≈911.06 birds"), "911.06 birds");
  assert.equal(partFinal("B(3) = 500e^(3/5) = 911.06 birds"), "911.06 birds");
  same("−8.25", "-8.25");
  same("2,406,118.05", "2406118.05");
  same("12.6 yrs", "12.6 years");
  same("4 feet", "4 foot");
  same("2 cm", "2 cms");
  same("x=5 or x=-5", "x=-5 or x=5");
  same("A(t)=500e^(0.2t)", "P(t) = 500e^(0.2t)"); // a bare function name is not compared
});

test("normalising never makes different answers equal", () => {
  for (const [a, b] of [
    ["x=79", "x=97"],
    ["−4", "4"],
    ["x = -1 + 2√3", "x = 1 + 2√3"],
    ["2x+3y=6", "4x+y=6"], // an equation, not a labelled chain: never cut to "6"
    ["(0,100)", "(0,10)"], // a pair's comma is not a thousands separator
    ["(1,000, 2)", "(1, 2)"],
    ["12.6 years", "12.6 hours"],
    ["y=-1; (0,7/2)", "y=-1; (0,-7/2)"],
  ]) diff(a, b);
  assert.equal(partFinal("2x+3y=6"), "2x+3y=6");
});

// From the review of this change: each of these scored "same" in a first draft.
test("prose is never compared by its first few words", () => {
  // Words with the same numbers are a person's call; never "the same".
  assert.equal(judgeAnswer("the function is increasing", "the function is decreasing"), "needs_human_check");
  assert.equal(judgeAnswer("all reals", "(-∞,∞)"), "needs_human_check");
  // Words with different numbers are wrong.
  diff("It is a vertical stretch by 2", "It is a vertical stretch by 3");
  diff("the answer for x is 5", "the answer for x is 6");
  diff("The population is 911.06 birds after three years", "The population is 911.07 birds after three years");
  diff("x = 5 the answer here is final", "x=6");
});

test("several solutions are compared item by item, never cut to the last", () => {
  diff("x=5 or x=-5", "x=-5");
  diff("x=5 or x=-5", "-5");
  diff("x=2, x=3", "x=3");
  diff("x=2, x=3", "x=2");
  diff("x = 2 and y = 3", "y=3");
});

// From the second review round.
test("a system of equations pairs its values by variable", () => {
  diff("x=2, y=3", "x=3, y=2");
  diff("x = 4, y = -1", "x = -1, y = 4");
  diff("x=2 and y=3", "y=2 and x=3");
  same("x=2, y=3", "y=3, x=2");
  same("x=±3", "x=3 or x=-3");
  same("x = -1 ± 2√3", "x=-1+2√3 or x=-1-2√3");
  diff("x=22/7≈3.14 or x=1", "x=π≈3.14 or x=1");
});

test("an approximation on one side only, or to more places, is still right", () => {
  same("x=ln(7)/2", "x=ln(7)/2≈0.97");
  same("x=(ln 7)/2≈0.973", "x = ln(7)/2 ≈ 0.97");
  diff("x=(ln 7)/2≈0.98", "x = ln(7)/2 ≈ 0.97");
});

test("label wording does not matter; label meaning does", () => {
  same("asymptote=y=0", "horizontal asymptote: y=0");
  same("y-int: 3", "y-intercept: 3");
  same("Answer: 5", "Solution: 5");
  diff("x-y=6", "6");
});

test("two exact values that round alike are different", () => {
  diff("x=22/7≈3.14", "x=π≈3.14");
  same("x=π≈3.14", "x = π ≈ 3.14");
});

test("an extra value in a read is wrong; only extra description is allowed", () => {
  diff("-5; 5", "5");
  diff("7; 8; 9", "8");
  diff("x=1; x=5; x=2", "x=1; x=2");
  same("left 3; down 2; flipped over; y=-1; (0,7/2)", "y=-1; (0,7/2)");
});

test("labels that carry meaning must match when both sides have one", () => {
  diff("P(5)=100", "P(6)=100");
  diff("max=5", "min=5");
  diff("vertex: (2,3)", "x-intercept: (2,3)");
  diff("4 ft", "4 in");
  diff("3 sqrt", "3");
});

test("units are words straight after a number; prose is three or more other words", () => {
  assert.deepEqual([...unitsIn("t=2log_2(10) years; t≈6.64 hours")].sort(), ["hour", "year"]);
  assert.deepEqual([...unitsIn("x=ln 7/ln 2")], []);
  assert.equal(isProse("911.06 birds"), false);
  assert.equal(isProse("left 3; down 2; flipped over; squeezed sideways"), true);
});

// ------------------------------------------------------------------ answer reading
test("answer reading: each way a faithful read was failed now scores as read faithfully", () => {
  const expected = [
    want("s1", "q1", "(-∞,∞); (-3,∞); y=-3", 100), // read with labels added
    want("s2", "q2", "-5.2", 50), // read with a Unicode minus
    want("s3", "q3", "y=-1; (0,7/2)", 100), // read as the full description
    want("s4", "q4", "50e^(.1t); 67.49", 100), // only the last part kept
    want("s5", "q5", "3ln10/ln2; 9.97", 100), // only the first part kept
  ];
  const replayed = [
    resp("s1", "q1", { answer: "x", finalAnswer: "domain=(-∞,∞); range=(-3,∞); asymptote=y=-3", correct: true, match: 100 }),
    resp("s2", "q2", { answer: "x", finalAnswer: "−5.2" }),
    resp("s3", "q3", { answer: "x", finalAnswer: "left 3; down 2; flipped over; y=-1; (0,7/2)" }),
    resp("s4", "q4", { answer: "made-up working", finalAnswer: "67.49", correct: true, match: 100 }),
    resp("s5", "q5", { answer: "made-up working", finalAnswer: "3ln10/ln2", correct: true, match: 100 }),
  ];
  const s = score.scoreAnswers(expected, replayed, "answer_reading", { q4: 2, q5: 2 });
  assert.equal(s.readRight, 5, "all five read faithfully");
  assert.equal(s.misses.wrong_final, 0);
  assert.deepEqual(s.partsMissing.map((x) => x.questionId), ["q4", "q5"], "multi-part shortfalls listed separately");
  assert.equal(s.partsMissing[0].read, "67.49");
  assert.equal(s.partsMissing[0].expected, "50e^(.1t); 67.49");
  assert.equal(s.readAccuracy, 1);
});

test("answer reading: prose that cannot be compared is listed for a human check, not counted as a miss", () => {
  const expected = [want("s1", "q1", "The graph rises slowly and then very quickly", 100), want("s2", "q1", "7", 100)];
  const replayed = [
    resp("s1", "q1", { answer: "x", finalAnswer: "It goes up gradually at first and afterwards climbs steeply" }),
    resp("s2", "q1", { answer: "7", finalAnswer: "7", correct: true, match: 100 }),
  ];
  const s = score.scoreAnswers(expected, replayed, "answer_reading");
  assert.equal(s.misses.wrong_final, 0);
  assert.equal(s.needsHumanCheck.length, 1);
  assert.equal(s.needsHumanCheck[0].read, "It goes up gradually at first and afterwards climbs steeply");
  assert.equal(s.needsHumanCheck[0].expected, "The graph rises slowly and then very quickly");
  assert.equal(s.readAccuracy, 1, "not a miss");
  assert.equal(s.readRight, 1, "and not counted as confirmed either");
});

test("answer reading: a wrong read is still wrong", () => {
  const s = score.scoreAnswers([want("s1", "q1", "-8.25", 88)], [resp("s1", "q1", { finalAnswer: "8.25" })], "answer_reading");
  assert.equal(s.readRight, 0);
  assert.equal(s.misses.wrong_final, 1);
});

// ------------------------------------------------------------------ hard-fail rules, unchanged
test("hard fail: one wrongly-correct answer fails the case even with every read faithful", () => {
  const expected = [want("s1", "q1", "domain=(2,∞)", 50), want("s2", "q1", "(2,∞)", 100)];
  const replayed = [
    resp("s1", "q1", { answer: "x", finalAnswer: "(2,∞)", correct: true, match: 100 }),
    resp("s2", "q1", { answer: "x", finalAnswer: "domain=(2,∞)", correct: true, match: 100 }),
  ];
  const s = score.scoreAnswers(expected, replayed, "answer_reading");
  assert.equal(s.readAccuracy, 1);
  assert.equal(s.wronglyCorrect, 1);
  assert.equal(s.passed, false);
});

test("hard fail: one wrongly-blank answer fails the case even with every other read faithful", () => {
  const expected = [want("s1", "q1", "x=−2", 100), ...Array.from({ length: 30 }, (_, i) => want("t" + i, "q1", "x = -2", 100))];
  const replayed = [
    resp("s1", "q1", { answer: "", match: 0 }),
    ...Array.from({ length: 30 }, (_, i) => resp("t" + i, "q1", { answer: "x=−2", finalAnswer: "x=−2", correct: true, match: 100 })),
  ];
  const s = score.scoreAnswers(expected, replayed, "answer_reading");
  assert.ok(s.readAccuracy >= 0.95);
  assert.equal(s.wronglyBlank, 1);
  assert.equal(s.passed, false);
});
