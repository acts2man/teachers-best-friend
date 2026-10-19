// Ricky, 15 Oct 2026: the student card counted skills at 80%+ and said
// "Proficient or above". He wants the count at the 70% standard score --
// every skill that is not Developing -- worded "{n}/{total} skills at or above
// 70% standard score". The cut-off comes from lib/mastery-levels.ts
// (needsReteach), so 69.9 is below it and 70 is at it. Made-up students only.
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
const { skillsAtStandard } = bundle("lib/teacher-data.ts");

const rec = (standard, score, i) => ({ id: standard + i, standard, score, date: "2026-10-0" + (i + 1), source: "c" });
const catalog = ["A", "B", "C", "D", "E"].map((code) => ({ code }));

test("skills at or above 70% are counted; Developing and unscored skills are not", () => {
  const s = {
    id: "s", name: "S", evidence: [
      ...[70, 70, 70].map((x, i) => rec("A", x, i)), // 70: Approaching -- counts (it did not at 80%+)
      ...[75, 79, 79].map((x, i) => rec("B", x, i)), // 77: Approaching -- counts
      ...[70, 70, 69.7].map((x, i) => rec("C", x, i)), // 69.9: Developing -- does not
      ...[95, 95, 95].map((x, i) => rec("D", x, i)), // 95: counts
      // E: no evidence -- does not
    ],
  };
  assert.equal(skillsAtStandard(s, catalog), 3);
});

test("the card says '{n}/{total} skills at or above 70% standard score', nowhere 'Proficient or above'", () => {
  const src = readFileSync("components/teacher-insights.tsx", "utf8");
  assert.match(src, /skillsAtStandard\(s, catalog\)/);
  assert.match(src, /\/\{catalog\.length\} skills at or above 70% standard score/);
  for (const f of ["components/teacher-insights.tsx", "components/teacher-assessments.tsx", "lib/teacher-data.ts", "lib/teacher-class-analysis.ts"])
    assert.doesNotMatch(readFileSync(f, "utf8"), /Proficient or above/, f);
});
