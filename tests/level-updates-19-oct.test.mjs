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
      ["Beginning", "0–69%", "red"],
      ["Approaching", "70–79%", "yellow"],
      ["Proficient", "80–89%", "blue"],
      ["Exceeding", "90–100%", "green"],
    ],
  );
});

test("boundaries on the rounded percentage, which is the one shown", () => {
  const at = (p) => [levels.masteryPercent(p), levels.masteryLevel(p).level];
  assert.deepEqual(at(69.4), [69, "Beginning"]);
  assert.deepEqual(at(69.5), [70, "Approaching"]);
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

test('no copy of "Developing" is left', () => {
  // The response-writing rubric's own score names were the last copy; Ricky
  // renamed them 1 Beginning / 2 Approaching / 3 Proficient / 4 Exceeding on
  // 20 Oct 2026. Only the files that record the old name are left.
  const allowed = new Set(["lib/writing-rubrics.ts", "tests/response-writing-genre.test.mjs", "tests/level-updates-19-oct.test.mjs"]);
  const files = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
  const left = files.filter((f) => !allowed.has(f) && !/\.(png|jpe?g|ico|woff2?|pdf)$/.test(f) && /\bDeveloping\b/.test(readFileSync(f, "utf8")));
  assert.deepEqual(left, []);
  // writing-rubrics.ts keeps the old names only in its comment saying what
  // they were; the scale itself has none.
  const scale = readFileSync("lib/writing-rubrics.ts", "utf8").split("\n").filter((l) => /\bDeveloping\b/.test(l));
  assert.ok(scale.every((l) => l.trim().startsWith("*")), "only in a comment: " + scale.join(" | "));
});
