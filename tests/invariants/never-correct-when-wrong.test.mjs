// RULE R4: never mark an answer correct when it is wrong; anything uncertain
// goes to Unsure for the teacher, not to a score. docs/system-map.md, rule R4.
//
// Credit comes from exactly one place: the grading model's "match" verdict,
// mapped by normalizeRecognizedResponses (lib/teacher-workflow.ts). The app's
// own math (lib/math-answer.ts) never grants credit; it can only take a
// "match" away when the student's value provably differs from the key.
//
// Incidents: 8 Oct 2026 (d2a02c5) -- questions the model skipped were scored
// blank for students who had written work; 12 Oct 2026 (#125, Ricky) -- the
// model matched answers whose sign was flipped, most often inside LaTeX
// (-\frac{3}{4} read as matching 3/4).
//
// This fuzz builds pairs of numeric answers in every notation the model and
// students produce -- integers, decimals, fractions, LaTeX \frac/\dfrac,
// LaTeX mixed numbers, Unicode minus, "x = " prefixes, stray spaces -- with
// their true values known, and checks:
//   - a "match" on a value that differs from the key is never correct;
//   - "other", "unsure" and "blank" never earn credit;
//   - a question the model skipped or answered twice is Unsure, never blank;
//   - compareAnswers (the key check) never says "same" for different values.
import test from "node:test";
import assert from "node:assert/strict";
import { bundle, rng, RUNS } from "./lib/bundle.mjs";

const W = bundle("lib/teacher-workflow.ts");
const M = bundle("lib/math-answer.ts");

/** A number written some way a page or a model writes it, and its value. */
function numeral(R) {
  const sign = R.chance(0.4) ? -1 : 1;
  const minus = () => R.pick(["-", "-", "−"]);
  const kind = R.pick(["int", "dec", "frac", "latex", "dfrac", "mixed"]);
  const n = R.int(1, 40);
  const d = R.int(2, 12);
  let text;
  let value;
  switch (kind) {
    case "int":
      value = n;
      text = String(n);
      break;
    case "dec":
      value = n / 4;
      text = String(n / 4);
      break;
    case "frac":
      value = n / d;
      text = `${n}/${d}`;
      break;
    case "latex":
      value = n / d;
      text = `\\frac{${n}}{${d}}`;
      break;
    case "dfrac":
      value = n / d;
      text = `\\dfrac{${n}}{${d}}`;
      break;
    case "mixed": {
      const w = R.int(1, 5);
      const num = R.int(1, d - 1);
      value = w + num / d;
      text = `${w}\\frac{${num}}{${d}}`;
      // A negative LaTeX mixed number is written with the minus outside.
      break;
    }
  }
  if (sign < 0) {
    value = -value;
    text = kind === "frac" && R.chance(0.3) ? `${minus()}${text}` : minus() + text;
  }
  return { text: dress(R, text), bare: text, value };
}

/** How the number sits on the line: alone, after "x = ", padded. */
const dress = (R, text) => R.pick([text, text, `x = ${text}`, ` ${text} `]);

/** The same numeral with its sign flipped -- the classic misread. */
function flipped(R, n) {
  const neg = /^[-\u2212]/.test(n.bare);
  return { text: dress(R, neg ? n.bare.slice(1) : "-" + n.bare), value: -n.value };
}

const key = (answer) => ({
  id: "a", classId: "c", title: "T", subject: "Math", grade: 6, framework: "California", createdAt: "", status: "Ready",
  questions: [{ id: "q", number: 1, text: "", passage: "", answer, standard: "", secondary: "", skill: "", dok: 1, alignment: 100, confidence: 100, level: "On grade", reasoning: "", verified: true, excluded: false }],
  responses: [], uploadIds: [], source: "manual", targetStandards: [],
});

const close = (x, y) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));

/** One graded response for `answer` with `verdict`, through the real mapping. */
const grade = (keyText, answer, verdict, finalAnswer = answer) =>
  W.normalizeRecognizedResponses(key(keyText), "s", [{ questionId: "q", answer, finalAnswer, verdict }])[0];

/** Returns the first violation, or null. */
function matchOnWrongValue(seed, normalize = W.normalizeRecognizedResponses) {
  const R = rng(seed);
  const k = numeral(R);
  // Half the time the classic trap: the same numeral with the sign flipped.
  const s = R.chance(0.5) ? flipped(R, k) : numeral(R);
  if (close(s.value, k.value)) return null;
  const r = normalize(key(k.text), "s", [{ questionId: "q", answer: s.text, finalAnswer: s.text, verdict: "match" }])[0];
  if (r.correct || r.match === 100) return `seed ${seed}: student ${JSON.stringify(s.text)} (${s.value}) marked correct against key ${JSON.stringify(k.text)} (${k.value})`;
  if (r.confidence !== 0) return `seed ${seed}: a demoted match is not Unsure (confidence ${r.confidence})`;
  return null;
}

test(`a "match" on a value that differs from the key is never correct (${RUNS * 4} pairs)`, () => {
  for (let seed = 1; seed <= RUNS * 4; seed++) {
    const bad = matchOnWrongValue(seed);
    assert.equal(bad, null, bad);
  }
});

test("the mapping before the sign guard (before #125) fails this check", () => {
  // Before d2b403d a "match" was full credit, whatever the value said.
  const old = (a, studentId, incoming) =>
    W.normalizeRecognizedResponses(a, studentId, incoming.map((r) => r)).map((r, i) =>
      incoming[i]?.verdict === "match" ? { ...r, correct: true, match: 100, confidence: 100 } : r,
    );
  let caught = null;
  for (let seed = 1; seed <= RUNS * 4 && !caught; seed++) caught = matchOnWrongValue(seed, old);
  assert.ok(caught, "expected the unguarded mapping to mark a wrong value correct");
});

test("only a match earns credit: other, unsure and blank never do", () => {
  const R = rng(7);
  for (let i = 0; i < RUNS; i++) {
    const k = numeral(R).text;
    const s = R.pick([numeral(R).text, k, "", "I don't know", "?"]);
    for (const verdict of ["other", "unsure", "blank"]) {
      const r = grade(k, s, verdict);
      assert.equal(r.correct, false, `${verdict} on ${JSON.stringify(s)} marked correct`);
      assert.notEqual(r.match, 100, `${verdict} on ${JSON.stringify(s)} given full credit`);
      if (verdict !== "blank") assert.equal(r.match, undefined, `${verdict} must leave the score for the teacher, got ${r.match}`);
    }
    assert.equal(grade(k, s, "unsure").confidence, 0, "unsure goes to the Unsure group");
  }
});

test("a question the model skipped or answered twice is Unsure, never blank or correct (8 Oct)", () => {
  const a = key("4");
  const skipped = W.normalizeRecognizedResponses(a, "s", [])[0];
  const twice = W.normalizeRecognizedResponses(a, "s", [
    { questionId: "q", answer: "4", verdict: "match" },
    { questionId: "q", answer: "5", verdict: "match" },
  ])[0];
  for (const r of [skipped, twice]) {
    assert.equal(r.correct, false);
    assert.equal(r.match, undefined, "not scored zero as a blank");
    assert.equal(r.confidence, 0, "lands in Unsure");
  }
  // And Grade by question shows it in the Unsure group, not with the blanks.
  const withResponse = { ...a, responses: [{ ...skipped, studentId: "s" }] };
  const groups = W.groupAnswers(withResponse, "q");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, W.UNSURE_KEY);
});

test("a non-blank verdict never wipes what the student wrote", () => {
  const R = rng(11);
  for (let i = 0; i < RUNS; i++) {
    const s = numeral(R).text;
    for (const verdict of ["match", "other", "unsure"]) {
      const r = grade(numeral(R).text, s, verdict);
      assert.equal(r.answer, s, `${verdict}: the transcription was dropped`);
    }
  }
});

test(`compareAnswers (the answer-key check) never calls two different numbers "same" (${RUNS * 4} pairs)`, () => {
  for (let seed = 1; seed <= RUNS * 4; seed++) {
    const R = rng(seed);
    const a = numeral(R);
    const b = R.chance(0.5) ? flipped(R, a) : numeral(R);
    if (close(a.value, b.value)) continue;
    assert.equal(M.compareAnswers(a.text, b.text), "different", `seed ${seed}: ${JSON.stringify(a.text)} (${a.value}) vs ${JSON.stringify(b.text)} (${b.value})`);
  }
});
