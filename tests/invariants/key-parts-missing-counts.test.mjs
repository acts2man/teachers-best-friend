// The replay scorer's answer-key pass mark (lib/regression/score.ts,
// scoreKey). docs/regression-replay.md.
//
// This is proven when: a read key that drops a part of a multi-part answer
// lowers the answer-key accuracy and can fail the 95% pass mark, while still
// being listed apart from the wrong answers. On main a short key answer was
// "not wrong": a read key with 10 of 10 answers each missing a part passed at
// 100%, though the app would have graded every student who wrote the whole
// answer against the short one.
//
// Made-up keys; no student text.
import test from "node:test";
import assert from "node:assert/strict";
import { bundle } from "./lib/bundle.mjs";

const S = bundle("lib/regression/score.ts");
const numbered = (list) => list.map((answer, i) => ({ number: i + 1, answer }));

test("a key answer missing a part counts against the pass mark, and is still listed apart", () => {
  const confirmed = numbered(["x=2; y=-1", "4", "7", "9", "11", "13", "15", "17", "19", "21"]);
  const read = numbered(["y=-1", "4", "7", "9", "11", "13", "15", "17", "19", "21"]);
  const s = S.scoreKey(confirmed, read);
  assert.deepEqual(s.partsMissing.map((x) => x.number), [1], "listed as missing a part");
  assert.deepEqual(s.wrong, [], "not listed as wrong");
  assert.equal(s.right, 9);
  assert.equal(s.accuracy, 0.9, "9 of 10 count toward the pass mark");
  assert.equal(s.passed, false, "90% is under the 95% answer-key pass mark");
});

test("every key answer short a part: 0%, not 100%", () => {
  const confirmed = numbered(Array.from({ length: 10 }, (_, i) => `x=${i + 2}; y=${-i - 1}`));
  const read = numbered(Array.from({ length: 10 }, (_, i) => `x=${i + 2}`));
  const s = S.scoreKey(confirmed, read);
  assert.equal(s.partsMissing.length, 10);
  assert.equal(s.accuracy, 0);
  assert.equal(s.passed, false);
});

test("a human check still does not count against it, and a complete key still passes", () => {
  const confirmed = numbered(["The graph rises through (0,1) and (1,3)", "4", "7", "9", "11", "13", "15", "17", "19", "21"]);
  const read = numbered(["A rising curve through (0,1) and (1,3)", "4", "7", "9", "11", "13", "15", "17", "19", "21"]);
  const s = S.scoreKey(confirmed, read);
  assert.equal(s.needsHumanCheck.length, 1);
  assert.equal(s.accuracy, 1);
  assert.equal(s.passed, true);
});
