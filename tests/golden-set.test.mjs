// The golden-set eval's scoring and cost maths (scripts/golden-set/score.mjs).
// The runner that calls the provider needs a key and runs in CI; these cover the
// pure pieces that turn model output + confirmed answers into the accuracy and
// cost numbers the report shows, so those numbers are trustworthy even though
// the run itself happens elsewhere.
import test from "node:test";
import assert from "node:assert/strict";
import {
  nameMatches,
  keyMatches,
  normAnswer,
  accuracy,
  requestCost,
  costPerClassSet,
} from "../scripts/golden-set/score.mjs";

test("nameMatches accepts exact and near-miss reads, rejects a different name", () => {
  assert.equal(nameMatches("Emily", "Emily"), true);
  assert.equal(nameMatches("Amenga", "Amena"), true, "one-letter slip still the same student");
  // A transposition ("Klyer" vs "Kyler") is two edits on a short name: the
  // teacher still has to fix the spelling, so it is NOT counted as a clean read.
  assert.equal(nameMatches("Klyer", "Kyler"), false, "misspelling is not a clean match");
  assert.equal(nameMatches("Hope Always", "Run Lowhill"), false);
  assert.equal(nameMatches("", "Emily"), false);
  assert.equal(nameMatches("Ivan", "Ibrahim"), false);
});

test("keyMatches treats equivalent short answers as equal, blanks as no match", () => {
  assert.equal(keyMatches("12 cm", "12cm"), true);
  assert.equal(keyMatches("1,000", "1000"), true);
  assert.equal(keyMatches("x = -4", "x=-4"), true);
  assert.equal(keyMatches("7", "8"), false);
  assert.equal(keyMatches("", ""), false, "two blanks is not a match");
  assert.equal(normAnswer("5,753 people"), "5753people");
});

test("accuracy counts correct, produced and missing", () => {
  const a = accuracy([
    { correct: true, produced: true },
    { correct: false, produced: true },
    { correct: false, produced: false }, // a gap the model never answered
    { correct: true, produced: true },
  ]);
  assert.equal(a.total, 4);
  assert.equal(a.correct, 2);
  assert.equal(a.produced, 3);
  assert.equal(a.missing, 1);
  assert.equal(a.pct, 50);
});

test("requestCost bills fresh and cached input and output from the price table", () => {
  const price = { input_per_mtok: 0.2, cached_input_per_mtok: 0.02, output_per_mtok: 1.25 };
  // 60,163 fresh input + 5,459 output, no cache -> matches the measured nano run.
  const c = requestCost({ input_tokens: 60163, output_tokens: 5459 }, price);
  assert.ok(Math.abs(c - 0.0188564) < 1e-6, "got " + c);
  // Cached input is billed at the cheaper rate.
  const c2 = requestCost({ input_tokens: 1000, cached_input_tokens: 400, output_tokens: 0 }, price);
  assert.ok(Math.abs(c2 - (600 * 0.2 + 400 * 0.02) / 1e6) < 1e-9);
});

test("costPerClassSet scales a run of any size to a 26-student set", () => {
  // $0.019 over 26 students stays $0.019; over 13 students it doubles.
  assert.ok(Math.abs(costPerClassSet(0.019, 26) - 0.019) < 1e-9);
  assert.ok(Math.abs(costPerClassSet(0.019, 13) - 0.038) < 1e-9);
  assert.equal(costPerClassSet(1, 0), 0, "no students -> no number, not a divide by zero");
});
