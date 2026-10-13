// The standards bug (12 Oct 2026): 85 of 138 questions read in the 48 hours
// before 23:56 UTC came back with no standard, because the AI's code had to
// equal a catalog code character for character. lib/standard-match.ts matches
// by meaning instead, falls back to the AI's second choice, keeps what the AI
// wrote, and never returns a code that is not in the teacher's catalog.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";

const require = createRequire(import.meta.url);
function bundle(entry) {
  const r = buildSync({
    entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false,
    external: ["pdfjs-dist/legacy/build/pdf.mjs"],
    alias: { "server-only": path.join(process.cwd(), "tests/fixtures/empty-module.cjs") },
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}
const { codeKey, matchCatalogCode, settleStandards } = bundle("lib/standard-match.ts");
const { catalogFor } = bundle("lib/teacher-catalog.ts");

const cat = (...codes) => codes.map((code) => ({ code }));
const grade7 = cat("7.RP.1", "7.RP.2", "7.RP.2a", "7.RP.2.a", "7.RP.3", "7.EE.1");
const hs = cat("F-IF.7", "F-BF.3", "F-LE.4", "A-APR.7");

test("spellings of a catalog code find it", () => {
  for (const [wrote, want, how] of [
    ["7.RP.3", "7.RP.3", "exact"],
    ["7.RP.A.3", "7.RP.3", "spelling"],
    ["CCSS.MATH.CONTENT.7.RP.A.3", "7.RP.3", "spelling"],
    [" 7.rp.3 ", "7.RP.3", "spelling"],
    ["7.RP.2.a", "7.RP.2.a", "exact"],
    ["7-RP-2a", "7.RP.2a", "spelling"],
  ]) assert.deepEqual(matchCatalogCode(wrote, grade7), { code: want, how }, wrote);
  for (const [wrote, want, how] of [
    ["HSF-IF.C.7", "F-IF.7", "spelling"],
    [" f-if.7 ", "F-IF.7", "spelling"],
    ["F.IF.7", "F-IF.7", "spelling"],
    ["F-IF.7e", "F-IF.7", "parent"],
    ["HSF-IF.C.7e", "F-IF.7", "parent"],
  ]) assert.deepEqual(matchCatalogCode(wrote, hs), { code: want, how }, wrote);
});

test("a sub-part that IS in the catalog is kept, not rolled up", () => {
  assert.deepEqual(matchCatalogCode("F-IF.7e", cat("F-IF.7", "F-IF.7e")), { code: "F-IF.7e", how: "exact" });
  assert.deepEqual(matchCatalogCode("F-IF.7.e", cat("F-IF.7", "F-IF.7e")), { code: "F-IF.7e", how: "spelling" });
});

test("never another grade, never a code the catalog lacks, never the grade letter of RL.K.1", () => {
  assert.deepEqual(matchCatalogCode("6.RP.A.3", grade7), { code: "", how: "" });
  assert.deepEqual(matchCatalogCode("8.EE.1", grade7), { code: "", how: "" });
  assert.deepEqual(matchCatalogCode("F-IF.9", hs), { code: "", how: "" });
  assert.equal(codeKey("RL.K.1"), "RL.K.1");
  assert.deepEqual(matchCatalogCode("RL.K.1", cat("RL.K.1", "RL.K.2")), { code: "RL.K.1", how: "exact" });
  assert.deepEqual(matchCatalogCode("rl.k.1", cat("RL.K.1", "RL.K.2")), { code: "RL.K.1", how: "spelling" });
});

test("whatever the AI writes, the standard is a catalog code or empty", () => {
  const junk = ["", "7", "RP", "7.RP", "7.RP.A", "F-IF", "HS", "....", "7.RP.3.4.5", "x".repeat(80), "F-IF.7ee", "7.RP.Z.3"];
  for (let i = 0; i < 400; i++) junk.push(Math.random().toString(36).slice(2) + "." + Math.floor(Math.random() * 12));
  for (const catalog of [grade7, hs])
    for (const wrote of junk) {
      const { code } = matchCatalogCode(wrote, catalog);
      assert.ok(code === "" || catalog.some((s) => s.code === code), wrote + " -> " + code);
    }
});

const q = (number, standard, secondary, o = {}) => ({ number, standard, secondary, alignment: 92, confidence: 95, reasoning: "Fits.", ...o });

test("settle: first choice kept as the AI scored it; second choice marked to check; none says what the AI wrote", () => {
  const { questions, records } = settleStandards([q(1, "HSF-IF.C.7", ""), q(2, "F-IF.9", "F-BF.3"), q(3, "F-IF.9", "")], hs);
  assert.deepEqual([questions[0].standard, questions[0].alignment, questions[0].confidence], ["F-IF.7", 92, 95]);
  assert.equal(questions[1].standard, "F-BF.3");
  assert.ok(questions[1].alignment <= 60, "never shown as a strong (green) fit");
  assert.ok(questions[1].confidence <= 50);
  assert.match(questions[1].reasoning, /first choice \(F-IF\.9\) isn't in your standards list; this is its second choice — check it/);
  assert.deepEqual([questions[2].standard, questions[2].alignment, questions[2].confidence], ["", 0, 0]);
  assert.match(questions[2].reasoning, /The AI suggested F-IF\.9, which isn't in your standards list/);
  assert.deepEqual(records.map((r) => [r.number, r.wrote, r.used, r.how]), [[1, "HSF-IF.C.7", "F-IF.7", "spelling"], [2, "F-IF.9", "F-BF.3", "second-choice"], [3, "F-IF.9", "", ""]]);
});

// ---- The replay: every saved read from the 48 hours before 23:56 UTC 12 Oct.
const fixture = JSON.parse(readFileSync("tests/fixtures/standards-reads-2026-10-12.json", "utf8"));
function catalogOf(grade) {
  const shared = (fixture.sharedCatalogs[String(grade)] ?? []).map((code) => ({ code, grade, framework: "California", subject: "Math", title: code }));
  return catalogFor({ customStandards: [], sharedStandards: shared }, grade, "California", "Math");
}

test("replay of the saved reads: blanks before and after, every match listed, Ricky's kept suggestions unchanged", () => {
  let questions = 0, blankBefore = 0, blankAfter = 0, secondChoice = 0;
  const listing = [];
  for (const read of fixture.reads) {
    const catalog = catalogOf(read.grade);
    const { questions: out, records } = settleStandards(read.q.map(([n, s, sec]) => q(n, s, sec, { alignment: s ? 95 : 0, confidence: s ? 95 : 0 })), catalog);
    questions += out.length;
    blankBefore += read.q.filter(([, s]) => !s).length;
    blankAfter += out.filter((x) => !x.standard).length;
    secondChoice += records.filter((r) => r.how === "second-choice").length;
    for (const r of records) listing.push(`${read.scan} Q${r.number}: first "${r.wrote}" second "${r.secondaryWrote}" -> ${r.used || "(none)"} [${r.how || "no match"}]`);
    for (const x of out) assert.ok(!x.standard || catalog.some((s) => s.code === x.standard), `${read.scan} Q${x.number}: ${x.standard} not in catalog`);
    // Ricky kept every suggestion on these two: the matcher changes none.
    if (read.ricky?.startsWith("kept")) read.q.forEach(([, s], i) => assert.equal(out[i].standard, s, `${read.scan} Q${i + 1}`));
  }
  if (process.env.SHOW_LISTING) console.log(listing.join("\n"));
  assert.equal(questions, 138);
  assert.equal(blankBefore, 85);
  assert.equal(secondChoice, 32, "32 blanks recovered from the AI's second choice");
  assert.equal(blankAfter, 53, "53 have no catalog code left in the saved row to recover");
});
