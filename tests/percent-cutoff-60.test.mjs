// New percent cut-offs (Ricky and Michael, 26 Oct 2026): Beginning 0–59.4%,
// Approaching 59.5–79.4%, Proficient 79.5–89.4%, Exceeding 89.5+, on the
// percentage rounded to the nearest whole number (the one shown). The
// student card keeps its own "at or above 70% standard score" count -- it no
// longer reads the level table, so a 65% skill is Approaching and still not
// counted. Every hard-coded copy of the old line moves with it. Made-up data
// only (rule R8).
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
const levels = bundle("lib/mastery-levels.ts");
const { skillsAtStandard } = bundle("lib/teacher-data.ts");

test("the cut-offs", () => {
  assert.deepEqual(levels.MASTERY_LEVELS.map((l) => [l.level, l.min, l.range]), [
    ["Beginning", 0, "0–59%"], ["Approaching", 60, "60–79%"], ["Proficient", 80, "80–89%"], ["Exceeding", 90, "90–100%"],
  ]);
  const at = (p) => [levels.masteryPercent(p), levels.masteryLevel(p).level];
  assert.deepEqual(at(59.4), [59, "Beginning"]);
  assert.deepEqual(at(59.5), [60, "Approaching"]);
  assert.deepEqual(at(65), [65, "Approaching"]);
  assert.deepEqual(at(79.4), [79, "Approaching"]);
  assert.deepEqual(at(79.5), [80, "Proficient"]);
  assert.deepEqual(at(89.5), [90, "Exceeding"]);
});

test("the student card keeps its own 70% line", () => {
  assert.equal(levels.STANDARD_SCORE_PERCENT, 70);
  const rec = (standard, score, i) => ({ id: standard + i, standard, score, date: "2026-10-0" + (i + 1), source: "c" });
  const s = { id: "s", name: "S", evidence: [
    ...[65, 65, 65].map((x, i) => rec("A", x, i)), // Approaching, below 70: not counted
    ...[70, 70, 68.5].map((x, i) => rec("B", x, i)), // 69.5 shows 70: counted
    ...[70, 70, 68.2].map((x, i) => rec("C", x, i)), // 69.4 shows 69: not counted
    ...[95, 95, 95].map((x, i) => rec("D", x, i)),
  ] };
  assert.equal(levels.masteryLevel(65).level, "Approaching");
  assert.equal(skillsAtStandard(s, ["A", "B", "C", "D"].map((code) => ({ code }))), 2);
  const data = readFileSync("lib/teacher-data.ts", "utf8");
  const fn = data.slice(data.indexOf("export function skillsAtStandard"), data.indexOf("export function classMastery"));
  assert.match(fn, /m >= STANDARD_SCORE_PERCENT/);
  assert.doesNotMatch(fn, /needsReteach/, "not read from the level table");
  assert.match(readFileSync("components/teacher-insights.tsx", "utf8"), /skills at or above 70% standard score/);
});

test("every hard-coded copy of the line moved", () => {
  assert.match(levels.MASTERY_LEVELS_NOTE, /Beginning 0–59% \(reteach\), Approaching 60–79% \(targeted practice\)/);
  const files = {
    "components/teacher-insights.tsx": [/students at Beginning \(59% or below\)/g, 2],
    "lib/analyze-shared.ts": [/approaching the standard \(60–79%\)/g, 1],
    "components/teacher-guide.tsx": [/Beginning 0–59% \(reteach and support\), Approaching 60–79%/g, 1],
    "README.md": [/Beginning 0–59%/g, 2],
  };
  for (const [f, [re, n]] of Object.entries(files)) assert.equal((readFileSync(f, "utf8").match(re) || []).length, n, f);
  for (const f of ["components/teacher-insights.tsx", "lib/analyze-shared.ts", "components/teacher-guide.tsx", "README.md", "lib/mastery-levels.ts", "lib/teacher-data.ts", "lib/teacher-class-analysis.ts"]) {
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /0–69%|70–79%|69% or below/, f);
  }
});
