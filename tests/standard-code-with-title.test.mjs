// Ricky, 14 Oct 2026: the AI wrote its first choice as code plus title --
// "F-IF.7 — Graph Functions and Key Features". codeKey turned the spaces into
// separators ("F.IF.7.—.GRAPH.FUNCTIONS..."), so matchCatalogCode found
// nothing, the app fell back to the AI's second choice, and told the teacher
// the first "isn't in your standards list" when it was. On production, 10 of
// 10 questions in his two reads on 15 Oct went that way; Michael's 18, written
// as bare codes, all matched.
//
// Now the code part is taken when a title is appended, and only the code is
// matched. The rule that never bends still holds: the result is a catalog
// code or nothing, and a title never makes a match on its own.
//
// Public standard codes and titles only; no student data (rule R8).
import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
function bundle(entry) {
  const r = buildSync({
    entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, absWorkingDir: ROOT,
    alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}
const { matchCatalogCode, settleStandards } = bundle("lib/standard-match.ts");
const { buildPrompt, READ_PROMPT_VERSION } = bundle("lib/analyze-shared.ts");

const catalog = ["N-CN.7", "F-IF.4", "F-BF.3", "A-APR.3", "F-IF.7"].map((code) => ({ code }));

test("a code with its title appended matches that code exactly as the first choice", () => {
  for (const [wrote, code] of [
    ["F-IF.7 — Graph Functions and Key Features", "F-IF.7"],
    ["F-BF.3 — Transform Function Graphs", "F-BF.3"],
  ]) {
    assert.deepEqual(matchCatalogCode(wrote, catalog), { code, how: "exact" }, wrote);
    const { questions, records } = settleStandards(
      [{ number: 1, standard: wrote, secondary: "A-APR.3", alignment: 90, confidence: 90, reasoning: "r" }],
      catalog,
    );
    assert.equal(questions[0].standard, code, "the first choice is used");
    assert.equal(questions[0].secondChoice, undefined, "not the second choice");
    assert.equal(questions[0].alignment, 90, "with the AI's own alignment");
    assert.equal(questions[0].reasoning, "r", "and no 'isn't in your standards list' note");
    assert.equal(records[0].how, "exact");
  }
});

test("every separator the AI uses before a title", () => {
  for (const sep of [" — ", " – ", " - ", ": ", " ("])
    assert.equal(matchCatalogCode("N-CN.7" + sep + "Solve quadratic equations with complex solutions" + (sep === " (" ? ")" : ""), catalog).code, "N-CN.7", JSON.stringify(sep));
  // And a spelling the matcher already handled, with a title on it.
  assert.equal(matchCatalogCode("HSF-IF.C.7 — Graph functions", catalog).code, "F-IF.7");
});

test("a title naming a different standard: the match is by the code only", () => {
  assert.equal(matchCatalogCode("F-IF.7 — Transform Function Graphs", catalog).code, "F-IF.7");
});

test("a code not in the catalog matches nothing, whatever its title says", () => {
  assert.deepEqual(matchCatalogCode("F-IF.9 — Graph Functions and Key Features", catalog), { code: "", how: "" });
  assert.deepEqual(matchCatalogCode("G-CO.5 — Transform Function Graphs", catalog), { code: "", how: "" });
  // A title alone, or a title first, is never a code.
  assert.deepEqual(matchCatalogCode("Graph Functions and Key Features", catalog), { code: "", how: "" });
  assert.deepEqual(matchCatalogCode("Transform Function Graphs — F-BF.3", catalog), { code: "", how: "" });
});

test("the secondary is read the same way", () => {
  const { questions } = settleStandards(
    [{ number: 1, standard: "F-IF.7 — Graph Functions and Key Features", secondary: "F-BF.3 — Transform Function Graphs", alignment: 80, confidence: 80, reasoning: "" }],
    catalog,
  );
  assert.equal(questions[0].secondary, "F-BF.3");
  // And as the stand-in when the first choice really is not in the list.
  const { questions: q2 } = settleStandards(
    [{ number: 1, standard: "F-IF.9 — Graph Functions", secondary: "F-BF.3 — Transform Function Graphs", alignment: 80, confidence: 80, reasoning: "" }],
    catalog,
  );
  assert.equal(q2[0].standard, "F-BF.3");
  assert.equal(q2[0].secondChoice, true);
});

test("the assignment prompt asks for the code only, and the read version moves on", () => {
  const { task } = buildPrompt(
    { mode: "assignment", grade: 9, subject: "Math", framework: "Common Core", targetStandards: ["F-IF.7"], text: "" },
    { assessments: [], students: [], classes: [], lessons: [] },
    catalog.map((s) => ({ ...s, title: "t", subject: "Math", grade: 9, framework: "Common Core", domain: "", cluster: "", wording: "w" })),
    true,
  );
  assert.match(task, /the code only/i);
  assert.ok(READ_PROMPT_VERSION >= 6, "a stored read from before must not be reused");
});
