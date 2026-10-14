// RULE R4 (never correct when wrong), gap G14: the sign guard was off whenever
// the key carried a unit, %, °, $, ±, a second part or "x is". docs/system-map.md.
//
// This is proven when: a grading model's "match" on "-12" against "12 cm³",
// "-50%" against "50%", "12 m" against "12 cm", "2; -3" or "3" against "x = ±3",
// and "x is 5" against "x is 6" goes to Unsure -- AND every answer below that
// is right but worded differently from its key ("30.14" for "30.14 years",
// "11,163" for "B. 11,163 people", a "Select:" or "Correct statements:" label,
// a thousands comma, a key that explains its answer in a sentence) keeps the
// model's match. On main the first half fails; the second half passes on main
// and must keep passing.
//
// The direction matters (14 Oct 2026): a first version (#143, first cut)
// required proof that the two were EQUAL and, measured on teacher-confirmed
// right answers, would have sent 130 of 216 in one class and 8 of 11 in the
// other to Unsure. The rule stays "a match stands unless the answer provably
// differs"; this only widens what counts as proof of a difference.
//
// Every answer here is made up. No student text is in this file.
import test from "node:test";
import assert from "node:assert/strict";
import { bundle, rng, RUNS } from "./lib/bundle.mjs";

const W = bundle("lib/teacher-workflow.ts");
const M = bundle("lib/math-answer.ts");

const key = (answer) => ({
  id: "a", classId: "c", title: "t", subject: "Math", grade: "7", status: "Ready", createdAt: "", dueDate: "",
  questions: [{ id: "q", number: 1, text: "", passage: "", answer, standard: "", secondary: "", skill: "", dok: 1, alignment: 100, confidence: 100, level: "On grade", reasoning: "", verified: true, excluded: false }],
});
/** The model said "match": does the app let it stand? */
const stands = (student, keyText) =>
  W.normalizeRecognizedResponses(key(keyText), "s", [{ questionId: "q", answer: student, finalAnswer: student, verdict: "match" }])[0].correct === true;

// [student, key]: the shapes the teachers' confirmed answers took on 14 Oct.
const REPORTED_RIGHT = [
  ["30.14", "30.14 years"],
  ["11,163", "B. 11,163 people"],
  ["7, 14, 21, 28, 35 and 3, 10, 17, 24, 31", "Select: 7, 14, 21, 28, 35 and 3, 10, 17, 24, 31."],
  ["5,921", "The missing digits are 5 and 2, completing 10,881 − 4,960 = 5,921."],
  ["61,640 + 1,111 = 62,751; 40,000 − 1 = 39,999", "Correct statements: 61,640 + 1,111 = 62,751; 40,000 − 1 = 39,999"],
];

// 50 made-up answers that are right and written differently from the key.
const RIGHT = [
  ...REPORTED_RIGHT,
  ["12", "12 cm³"],
  ["12 cubic cm", "12 cm³"],
  ["12 cm^3", "12 cm³"],
  ["-12", "−12 cm³"],
  ["50", "50%"],
  ["50 percent", "50%"],
  ["0.5", "50%"],
  ["-50%", "−50%"],
  ["30", "30°"],
  ["30 degrees", "30°"],
  ["-30", "−30°F"],
  ["4.50", "$4.50"],
  ["$4.50", "4.50 dollars"],
  ["-$4.50", "−$4.50"],
  ["9,876", "9876"],
  ["9876", "B) 9,876 marbles"],
  ["2,400 km", "2400 kilometers"],
  ["45 mph", "45 miles per hour"],
  ["3.5 hours", "3.5 h"],
  ["16 sq ft", "16 ft²"],
  ["16 square feet", "16 ft^2"],
  ["x = 3, x = -3", "x = ±3"],
  ["±3", "x = 3 or x = −3"],
  ["-3, 3", "x = ±3"],
  ["3 and -3", "±3"],
  ["x = 2; y = -1", "x = 2; y = −1"],
  ["y = -1; x = 2", "x = 2, y = −1"],
  ["x is 5", "x = 5"],
  ["5", "x is 5"],
  ["The answer is 72", "72"],
  ["72", "Answer: 72"],
  ["about 3.14", "3.14"],
  ["2, 4, 6, 8", "Select: 2, 4, 6, and 8."],
  ["C", "C. 1,250 tickets"],
  ["1,250", "(C) 1,250 tickets"],
  ["1250 tickets", "C. 1,250 tickets"],
  ["3/4", "0.75"],
  ["0.75 kg", "3/4 kg"],
  ["15 students", "15"],
  ["11163", "11,163 people"],
  ["photosynthesis", "Photosynthesis"],
  ["The mean is larger than the median.", "The mean is larger than the median, because of the outlier at 90."],
  ["y = 2x + 1", "y = 2x + 1"],
  ["2(x + 3)", "2x + 6"],
  ["x > -2", "x > −2"],
];

// Made-up wrong answers a model has matched or could match. The first group
// is the G14 gap itself and must all be caught.
const G14_WRONG = [
  ["-12", "12 cm³"],
  ["12", "−12 cm³"],
  ["-50%", "50%"],
  ["-30°", "30°"],
  ["-$4.50", "$4.50"],
  ["12 m", "12 cm"],
  ["30.14 months", "30.14 years"],
  ["±3", "3"],
  ["3", "x = ±3"],
  ["2; -3", "2"],
  ["x = 3", "x = 3, x = -3"],
  ["x is 5", "x is 6"],
];
const OTHER_WRONG = [
  ["-11,163", "B. 11,163 people"],
  ["11,136", "11,163 people"],
  ["-30.14", "30.14 years"],
  ["7, 14, 21, 28, 35", "Select: 7, 14, 21, 28, 35 and 3, 10, 17, 24, 31."],
  ["x = 2, y = 1", "x = 2, y = −1"],
  ["x = -1, y = 2", "x = 2, y = −1"],
  ["16 ft", "16 ft²"],
  ["45 km/h", "45 mph"],
  ["0.5", "5%"],
  ["The answer is -72", "72"],
];

test("G14: a match on a value the key's unit, %, °, $, ± or list hid is no longer correct", () => {
  for (const [student, k] of G14_WRONG) assert.equal(stands(student, k), false, `${JSON.stringify(student)} for ${JSON.stringify(k)}`);
});

test("G14: the answer-key check no longer calls \"x is 5\" and \"x is 6\", or \"x = 3, x = -3\" and \"x = 3\", the same", () => {
  assert.equal(M.compareAnswers("x is 5", "x is 6"), "different");
  assert.equal(M.compareAnswers("x = 3, x = -3", "x = 3"), "different");
  assert.equal(M.compareAnswers("x = 3 or x = -3", "x = ±3"), "same");
  assert.equal(M.compareAnswers("x is 5", "x = 5"), "same");
});

test("the five answers the teachers confirmed right on 14 Oct (in made-up form) keep the model's match", () => {
  for (const [student, k] of REPORTED_RIGHT) assert.equal(stands(student, k), true, `${JSON.stringify(student)} for ${JSON.stringify(k)}`);
});

test(`all ${RIGHT.length} right-but-differently-worded answers keep the model's match`, () => {
  assert.equal(RIGHT.length, 50);
  const demoted = RIGHT.filter(([s, k]) => !stands(s, k));
  assert.deepEqual(demoted, [], "a right answer sent to Unsure");
});

test(`wrong answers caught: all ${G14_WRONG.length} G14 cases and all ${OTHER_WRONG.length} others`, () => {
  const missed = OTHER_WRONG.filter(([s, k]) => stands(s, k));
  assert.deepEqual(missed, [], "a wrong answer still marked correct");
});

// A fuzz: a number dressed the way keys are written (a label, a unit or
// noun, a thousands comma, a closing full stop), and a student who wrote the
// same number -- bare, or with the unit -- is never demoted; one who wrote it
// with the sign flipped always is.
const LABELS = ["", "", "Answer: ", "B. ", "(C) ", "D) ", "Select: ", "The answer is "];
const AFTER = ["", "", " cm", " cm³", " km", " years", " people", " marbles", "%", "°", " dollars", " sq ft", " kg"];
function dressed(R) {
  const whole = R.int(1, 99999);
  const value = R.chance(0.3) ? whole + R.int(1, 99) / 100 : whole;
  const commas = R.chance(0.5);
  const digits = (v) => {
    const [i, d] = String(v).split(".");
    return (commas ? i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : i) + (d ? "." + d : "");
  };
  const after = R.pick(AFTER);
  const dollar = after === "" && R.chance(0.2) ? "$" : "";
  return { value, digits, after, dollar, label: R.pick(LABELS), stop: R.chance(0.3) ? "." : "" };
}

test(`a number dressed like a key: the same number stands, the sign flipped never does (${RUNS * 4} keys)`, () => {
  const R = rng(1414);
  for (let i = 0; i < RUNS * 4; i++) {
    const d = dressed(R);
    const neg = R.chance(0.3);
    const show = (v, sign) => (sign ? "−" : "") + d.dollar + d.digits(v);
    const k = `${d.label}${show(d.value, neg)}${d.after}${d.stop}`;
    const plainNumber = show(d.value, neg).replace("−", "-").replace(/,/g, R.chance(0.5) ? "," : "");
    const sameStudent = R.pick([plainNumber, plainNumber + d.after]);
    assert.equal(stands(sameStudent, k), true, `${JSON.stringify(sameStudent)} for ${JSON.stringify(k)} was demoted`);
    const flippedStudent = (neg ? "" : "-") + d.dollar + d.digits(d.value) + R.pick(["", d.after]);
    assert.equal(stands(flippedStudent, k), false, `${JSON.stringify(flippedStudent)} for ${JSON.stringify(k)} still correct`);
  }
});
