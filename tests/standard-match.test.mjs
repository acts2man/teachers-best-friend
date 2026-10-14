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
const { codeKey, matchCatalogCode, settleStandards, isSecondChoice, withoutStandardNote } = bundle("lib/standard-match.ts");
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
  assert.equal(questions[1].alignment, 0, "no score: the AI's 92 was for its first choice (#129 round 3)");
  assert.ok(questions[1].confidence <= 50);
  assert.ok(isSecondChoice(questions[1]));
  assert.match(questions[1].reasoning, /first choice \(F-IF\.9\) isn't in your standards list; this is its second choice/);
  assert.equal(withoutStandardNote(questions[1].reasoning), "Fits.", "the note comes off cleanly");
  assert.equal(withoutStandardNote("[AI's second choice — check it] my own careful explanation"), "my own careful explanation", "a teacher's edited text is never wiped");
  const pilcrow = settleStandards([q(1, "F-IF.9 ¶ x", "F-BF.3")], hs).questions[0];
  assert.equal(withoutStandardNote(pilcrow.reasoning), "Fits.");
  assert.deepEqual([questions[2].standard, questions[2].alignment, questions[2].confidence], ["", 0, 0]);
  assert.match(questions[2].reasoning, /The AI suggested F-IF\.9, which isn't in your standards list/);
  assert.deepEqual(records.map((r) => [r.number, r.wrote, r.used, r.how]), [[1, "HSF-IF.C.7", "F-IF.7", "spelling"], [2, "F-IF.9", "F-BF.3", "second-choice"], [3, "F-IF.9", "", ""]]);
});

test("review round 1: no runner-up over an empty or 'Unrelated' first choice; ambiguous spellings match nothing; spaces and inner clusters", () => {
  const empty = settleStandards([q(1, "", "F-BF.3"), q(2, "F-IF.9", "F-BF.3", { level: "Unrelated" })], hs).questions;
  assert.deepEqual(empty.map((x) => x.standard), ["", ""], "the AI said these fit no standard");
  assert.equal(empty[0].secondary, "F-BF.3", "its second choice is still shown as the secondary");
  // A custom "HSS.7.1" beside "S.7.1" may be two standards: neither is guessed.
  assert.deepEqual(matchCatalogCode("S-7.1", cat("HSS.7.1", "HSS.7.2", "S.7.1")), { code: "S.7.1", how: "spelling" });
  assert.deepEqual(matchCatalogCode("HSS-7.1", cat("HSS.7.1", "S.7.1")), { code: "HSS.7.1", how: "spelling" });
  assert.deepEqual(matchCatalogCode("hss 7 1", cat("HSS.7.1", "S.7.1")), { code: "HSS.7.1", how: "spelling" });
  assert.deepEqual(matchCatalogCode("HSS.C.7.1", cat("HSS.7.1", "S.7.1")), { code: "", how: "" }, "could be either: neither");
  assert.deepEqual(matchCatalogCode("7 RP 3", grade7), { code: "7.RP.3", how: "spelling" });
  assert.deepEqual(matchCatalogCode("HSG-SRT.C.8.1", cat("G-SRT.8", "G-SRT.8.1")), { code: "G-SRT.8.1", how: "spelling" });
  const long = settleStandards([q(1, "X".repeat(500), "")], hs).questions[0];
  assert.ok(long.reasoning.length < 200, "the echoed code is capped");
});

test("'Looks good — confirm all' leaves the AI's second choices for the teacher; confirming removes the note", () => {
  const { confirmAllQuestions } = bundle("lib/teacher-workflow.ts");
  const settled = settleStandards([q(1, "F-IF.7", ""), q(2, "F-IF.9", "F-BF.3")], hs).questions.map((x, i) => ({ ...x, id: "q" + i, text: "", passage: "", answer: "", skill: "s", dok: 1, verified: false, excluded: false }));
  const out = confirmAllQuestions({ questions: settled, status: "Needs review" });
  assert.equal(out.confirmed, 1);
  assert.equal(out.secondChoice, 1);
  assert.equal(out.assessment.questions[1].verified, false);
});

// ---- The replay: every saved read from the 48 hours before 23:56 UTC 12 Oct.
const fixture = JSON.parse(readFileSync("tests/fixtures/standards-reads-2026-10-12.json", "utf8"));
function catalogOf(grade) {
  const shared = (fixture.sharedCatalogs[String(grade)] ?? []).map((code) => ({ code, grade, framework: "California", subject: "Math", title: code }));
  return catalogFor({ customStandards: [], sharedStandards: shared }, grade, "California", "Math");
}

/** The saved rows hold the first choice AFTER the old filter blanked it, so a
 * blank cannot say what the AI wrote. Two readings are replayed: as stored
 * (the AI wrote nothing), and with each blank treated as a code the old filter
 * rejected (`unmatched`). The truth is between them; standardMatches on
 * fresh reads after deploy will say which. */
function replay(blankAs) {
  let questions = 0, blankBefore = 0, blankAfter = 0, secondChoice = 0, spelling = 0;
  let rickyAgree = 0, rickyCompared = 0;
  const listing = [];
  for (const read of fixture.reads) {
    const catalog = catalogOf(read.grade);
    const { questions: out, records } = settleStandards(read.q.map(([n, s, sec]) => q(n, s || blankAs, sec, { alignment: s ? 95 : 0, confidence: s ? 95 : 0 })), catalog);
    questions += out.length;
    blankBefore += read.q.filter(([, s]) => !s).length;
    blankAfter += out.filter((x) => !x.standard).length;
    secondChoice += records.filter((r) => r.how === "second-choice").length;
    spelling += records.filter((r) => r.how === "spelling" || r.how === "parent").length;
    for (const r of records) listing.push(`${read.scan} Q${r.number}: first "${r.wrote}" second "${r.secondaryWrote}" -> ${r.used || "(none)"} [${r.how || "no match"}]`);
    for (const x of out) assert.ok(!x.standard || catalog.some((s) => s.code === x.standard), `${read.scan} Q${x.number}: ${x.standard} not in catalog`);
    if (read.ricky?.startsWith("kept")) read.q.forEach(([, s], i) => assert.equal(out[i].standard, s, `${read.scan} Q${i + 1}`));
    // Where Ricky set the standard by hand, how often does a second-choice fill agree?
    const handSet = read.ricky?.match(/^(\S+) on all/);
    if (handSet) for (const r of records) if (r.how === "second-choice") { rickyCompared++; if (r.used === handSet[1]) rickyAgree++; }
  }
  return { questions, blankBefore, blankAfter, secondChoice, spelling, rickyAgree, rickyCompared, listing };
}

test("replay of the saved reads, two readings of the destroyed first choices; Ricky's kept suggestions unchanged", () => {
  const stored = replay("");
  assert.equal(stored.questions, 138);
  assert.equal(stored.blankBefore, 85);
  assert.equal(stored.blankAfter, 85, "as stored: an empty first choice is never overruled");
  const rejected = replay("?rejected-by-old-filter");
  assert.equal(rejected.blankAfter, 53, "if each blank was a rejected code: 32 filled from the second choice");
  assert.equal(rejected.secondChoice, 32);
  assert.equal(rejected.spelling, 0, "the saved data cannot show the spelling fix: the codes it would correct were destroyed");
  assert.deepEqual([rejected.rickyAgree, rejected.rickyCompared], [13, 20], "on Ricky's hand-set tests the second choice agrees 13 of 20");
  if (process.env.SHOW_LISTING) console.log(rejected.listing.join("\n"));
});

// ---- #129 round 3 -----------------------------------------------------------
// 2a. An unconfirmed second choice counted toward the assessment's alignment
// average at a made-up score -- 60, or 50 where the read had none -- and kept
// it once confirmed. On Ricky's scan c2e875b2 only 3 of its 10 second choices
// matched his own tags; the old code showed 15% (3 x 50 / 10) built on guesses.
// 2b. The second-choice flag was text at the start of the editable reasoning:
// delete it, press "Looks good — confirm all", and the guess was confirmed.
const { alignment } = bundle("lib/teacher-data.ts");
function asAssessment(read, blankAs) {
  const settled = settleStandards(read.q.map(([n, s, sec]) => q(n, s || blankAs, sec, { alignment: s ? 95 : 0, confidence: s ? 95 : 0 })), catalogOf(read.grade)).questions;
  return {
    id: "a", title: "T", classId: "c", status: "Needs review", targetStandards: read.targets, responses: [],
    questions: settled.map((x, i) => ({ ...x, id: "q" + i, text: "", passage: "", answer: "", skill: "s", dok: 1, verified: false, excluded: false })),
  };
}

test("2a: unconfirmed second choices are not in the alignment average (c2e875b2 showed 15% built on guesses)", () => {
  const read = fixture.reads.find((r) => r.scan === "c2e875b2");
  const a = asAssessment(read, "?rejected-by-old-filter");
  assert.equal(a.questions.filter((x) => isSecondChoice(x)).length, 10);
  assert.equal(alignment(a), null, "nothing the AI actually scored: no average, not 15%");
});

test("2a: a confirmed second choice is the teacher's pick -- no made-up score, as for any standard they choose", () => {
  const { confirmQuestion } = bundle("lib/teacher-workflow.ts");
  const read = fixture.reads.find((r) => r.scan === "c2e875b2");
  const a = asAssessment(read, "?rejected-by-old-filter");
  const confirmed = confirmQuestion(a.questions[6]);
  assert.equal(isSecondChoice(confirmed), false);
  assert.equal(confirmed.verified, true);
  assert.equal(confirmed.alignment, 0, "blank, shown as 'You chose it', never 60");
  assert.equal(alignment({ ...a, questions: a.questions.map((x, i) => (i === 6 ? confirmed : x)) }), null);
});

test("2b: the flag is its own field: deleting the note from the reasoning never makes 'confirm all' take the guess", () => {
  const { confirmAllQuestions } = bundle("lib/teacher-workflow.ts");
  const settled = settleStandards([q(1, "F-IF.7", ""), q(2, "F-IF.9", "F-BF.3")], hs).questions.map((x, i) => ({ ...x, id: "q" + i, text: "", passage: "", answer: "", skill: "s", dok: 1, verified: false, excluded: false }));
  assert.equal(settled[1].secondChoice, true);
  const edited = settled.map((x, i) => (i === 1 ? { ...x, reasoning: "The teacher rewrote this." } : x));
  const out = confirmAllQuestions({ questions: edited, status: "Needs review" });
  assert.equal(out.secondChoice, 1);
  assert.equal(out.assessment.questions[1].verified, false, "still the teacher's to check");
});

test("2a review: a read the AI DID score -- the second choice still gets no score, before or after confirming", () => {
  const { confirmQuestion } = bundle("lib/teacher-workflow.ts");
  const settled = settleStandards([q(1, "F-IF.7", "", { alignment: 95 }), q(2, "F-IF.9", "F-BF.3", { alignment: 92 })], hs).questions
    .map((x, i) => ({ ...x, id: "q" + i, text: "", passage: "", answer: "", skill: "s", dok: 1, verified: false, excluded: false }));
  assert.equal(settled[1].alignment, 0, "the 92 was the first choice's");
  const a = { id: "a", title: "T", classId: "c", status: "Needs review", targetStandards: ["F-IF.7", "F-BF.3"], responses: [], questions: settled };
  assert.equal(alignment(a), 95, "only the scored first choice counts");
  const confirmed = { ...a, questions: [settled[0], confirmQuestion(settled[1])] };
  assert.equal(confirmed.questions[1].alignment, 0, "confirmed: the teacher's pick, no made-up score");
  assert.equal(alignment(confirmed), 95);
});

test("2b review: fails safe -- if the field is lost (code before the migration), the note still marks the guess", () => {
  const { confirmAllQuestions, confirmQuestion, alignmentIsStrong } = bundle("lib/teacher-workflow.ts");
  const settled = settleStandards([q(1, "F-IF.9", "F-BF.3")], hs).questions.map((x) => ({ ...x, id: "q0", text: "", passage: "", answer: "", skill: "s", dok: 1, verified: false, excluded: false }));
  const dropped = { ...settled[0] };
  delete dropped.secondChoice;
  assert.ok(isSecondChoice(dropped));
  assert.equal(alignmentIsStrong(dropped), false, "never green 'You chose it'");
  assert.equal(confirmAllQuestions({ questions: [dropped], status: "Needs review" }).secondChoice, 1);
  assert.equal(isSecondChoice(confirmQuestion(dropped)), false, "confirming clears it either way");
});
