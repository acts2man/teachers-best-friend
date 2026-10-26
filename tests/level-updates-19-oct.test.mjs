// Ricky's level updates (19 Oct 2026):
//   1. the lowest level is "Beginning" (it was "Developing"), everywhere;
//   2. levels are read from the percentage rounded to the nearest whole
//      number, and that rounded number is the one shown -- 69.5 shows "70%"
//      and is Approaching (it showed 69% and sat in the lowest level);
//   3. each level carries a recommendation shown beside its action button:
//      Reteach Recommended / Monitor / Ready to Move On / Extension Recommended;
//   4. the "Independent practice" group is "Additional Practice".
// Colours are unchanged. Made-up students only (rule R8).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { buildSync } from "esbuild";

function bundle(path) {
  const r = buildSync({ entryPoints: [path], bundle: true, platform: "node", format: "cjs", write: false });
  const m = { exports: {} };
  new Function("module", "exports", r.outputFiles[0].text)(m, m.exports);
  return m.exports;
}
const levels = bundle("lib/mastery-levels.ts");

test("the four levels: Beginning first, colours unchanged", () => {
  assert.deepEqual(
    levels.MASTERY_LEVELS.map((l) => [l.level, l.range, l.tone]),
    [
      ["Beginning", "0–59%", "red"],
      ["Approaching", "60–79%", "yellow"],
      ["Proficient", "80–89%", "blue"],
      ["Exceeding", "90–100%", "green"],
    ],
  );
});

test("boundaries on the rounded percentage, which is the one shown", () => {
  const at = (p) => [levels.masteryPercent(p), levels.masteryLevel(p).level];
  // The Beginning line is 59.5 since 26 Oct 2026 (it was 69.5).
  assert.deepEqual(at(59.4), [59, "Beginning"]);
  assert.deepEqual(at(59.5), [60, "Approaching"]);
  assert.deepEqual(at(79.4), [79, "Approaching"]);
  assert.deepEqual(at(79.5), [80, "Proficient"]);
  assert.deepEqual(at(89.4), [89, "Proficient"]);
  assert.deepEqual(at(89.5), [90, "Exceeding"]);
});

test("each level's recommendation beside its action button", () => {
  assert.deepEqual(
    levels.MASTERY_LEVELS.map((l) => [l.level, l.advice, l.nextStep.label]),
    [
      ["Beginning", "Reteach Recommended", "Reteach"],
      ["Approaching", "Monitor", "Offer targeted practice"],
      ["Proficient", "Ready to Move On", "Offer optional reinforcement"],
      ["Exceeding", "Extension Recommended", "Offer extension activity"],
    ],
  );
  const card = readFileSync("components/teacher-assessments.tsx", "utf8");
  assert.match(card, /<div className="level-next-step" key=\{l\.level\}>\s*<span className=\{"pill level-advice level-" \+ l\.tone\}>\{l\.advice\}<\/span>\s*<Action/);
});

test('the practice group is "Additional Practice"', () => {
  const src = readFileSync("components/teacher-insights.tsx", "utf8");
  assert.match(src, /"Additional Practice"/);
  assert.doesNotMatch(src, /Independent practice/i);
});

test('no copy of "Developing" is left, outside the response-writing rubric\'s own score names', () => {
  // The response-writing rubric scores a trait 4 Excellent, 3 Proficient,
  // 2 Developing, 1 Beginning: a rubric's score names, not the mastery level.
  // Left as is and raised with Ricky (see the PR).
  const allowed = new Set(["lib/writing-rubrics.ts", "tests/response-writing-genre.test.mjs", "tests/level-updates-19-oct.test.mjs"]);
  const files = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
  const left = files.filter((f) => !allowed.has(f) && !/\.(png|jpe?g|ico|woff2?|pdf)$/.test(f) && /\bDeveloping\b/.test(readFileSync(f, "utf8")));
  assert.deepEqual(left, []);
  for (const f of ["lib/writing-rubrics.ts"])
    for (const line of readFileSync(f, "utf8").split("\n").filter((l) => /\bDeveloping\b/.test(l)))
      assert.match(line, /2 Developing, 1 Beginning/, f + ": " + line.trim());
});
