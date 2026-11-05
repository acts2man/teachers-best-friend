// Answers on the wrong paper (Michael, 2 Nov 2026, "Story Organizer", ELA
// grade 4): production scan 9df4a4a3, seven pages in one grading request,
// groups [[0]..[6]], returned group 5 with the answers written on the page of
// group 6 and the other way round, and one answer on both groups 4 and 6.
// Proven when:
//   (b) the grading request also returns the name it reads on each group, the
//       app compares it with the pile's confirmed student, and on a mismatch
//       that student's answers are marked "Answers may belong to another page
//       — check" -- nothing is moved for the teacher;
//   (c) the teacher can move a student's answers to another student on the
//       same test (a swap when that one has answers), and correct what an
//       answer was read as.
// Placeholder names only (R8). The shape is the recorded one: seven one-page
// groups, nine answers each, groups 5 and 6 swapped.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildSync } from "esbuild";

const ROOT = process.cwd();
function bundle(entry) {
  const r = buildSync({
    entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, absWorkingDir: ROOT,
    alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, () => ({}));
  return m.exports;
}
const M = bundle("lib/answer-mixups.ts");
const N = bundle("lib/name-seen.ts");
const W = bundle("lib/teacher-workflow.ts");
const C = bundle("lib/teacher-class-scan.ts");
const A = bundle("lib/analyze-shared.ts");

const NAMES = ["Ana Bell", "Ben Cole", "Cara Dunn", "Dev Ellis", "Eli Ford", "Fay Gray", "Gus Hale"];
const students = NAMES.map((name, i) => ({ id: "s" + i, classId: "c1", name, color: "#000", evidence: [], notes: "" }));
const QUESTIONS = Array.from({ length: 9 }, (_, i) => ({
  id: "q" + (i + 1), number: i + 1, text: "Q" + (i + 1), passage: "", answer: "key " + (i + 1), standard: "RL.4.3",
  secondary: "", skill: "s", dok: 2, costas: 2, alignment: 90, confidence: 90, level: "On grade", reasoning: "",
  verified: true, excluded: false,
}));
const assessment = {
  id: "a1", classId: "c1", title: "Organizer", subject: "ELA", elaArea: "reading", grade: 4, framework: "Common Core",
  createdAt: "", status: "Ready", source: "ai", targetStandards: ["RL.4.3"], answerKeyVerified: true,
  uploadIds: [], studentUploadIds: {}, responses: [], questions: QUESTIONS,
};
const answersOf = (who) => QUESTIONS.map((q) => ({ questionId: q.id, answer: who + " wrote " + q.number, verdict: "other", confidence: 90 }));

// The recorded shape: the grading pass reads page 6's paper as group 5 and
// page 5's as group 6.
const pageGroups = NAMES.map((_, i) => [i]);
const ids = NAMES.map((_, i) => "p" + i);
const names = NAMES.map((name, i) => ({ page: i, name, confidence: 95 }));
const paperOf = (g) => (g === 5 ? 6 : g === 6 ? 5 : g);
const graded = pageGroups.map((_, g) => ({ group: g, nameSeen: NAMES[paperOf(g)], responses: answersOf(NAMES[paperOf(g)]) }));

test("the grading request asks for the name on each group, in one field, and passes it back trimmed", () => {
  const catalog = [{ code: "RL.4.3", title: "R", subject: "ELA", grade: 4, framework: "Common Core", domain: "", cluster: "", wording: "w" }];
  const ws = { assessments: [assessment], students, classes: [{ id: "c1", name: "P1" }], lessons: [] };
  const p = A.analyzeInput.parse({ mode: "class_scan", grade: 4, subject: "ELA", framework: "Common Core", targetStandards: ["RL.4.3"], assessmentId: "a1", uploadIds: ids, pageGroups });
  const built = A.buildPrompt(p, ws, catalog, true);
  const group = built.schema.properties.groups.items;
  assert.deepEqual(group.required, ["group", "nameSeen", "responses"]);
  for (const s of students) assert.equal(built.task.includes(s.name), false, "no roster name in the prompt");
  const out = A.finalizeAnalysis(p, { groups: [{ group: 0, nameSeen: "  Ana   Bell \n", responses: [] }, { group: 1, responses: [] }] }, ws, catalog);
  assert.equal(out.groups[0].nameSeen, "Ana Bell");
  assert.equal(out.groups[1].nameSeen, "", "an older answer without it reads as no name");
  const placeholder = A.finalizeAnalysis(p, { groups: [{ group: 0, nameSeen: "[unreadable]", responses: [] }] }, ws, catalog);
  assert.equal(placeholder.groups[0].nameSeen, "", "a placeholder is no name");
});

test("only a real name counts: no letters or a placeholder is blank, and never flags", () => {
  for (const blank of ["?", "??", "—", "123", "unreadable", "Illegible", "Name:", "NAME", "n/a", "N/A", "none", "unknown", "[unreadable]", "no name", "", "   "])
    assert.equal(N.usableNameSeen(blank), "", JSON.stringify(blank));
  assert.equal(N.usableNameSeen("  Ana   Bell \n"), "Ana Bell");
  assert.equal(M.seenFitsFor("unreadable", students), undefined);
  assert.equal(M.pagesMayBelongElsewhere(M.seenFitsFor("?", students), "s5", "Fay Gray", students), false);
});

test("the read name is kept only as which students it could be", () => {
  assert.deepEqual(M.seenFitsFor("Gus Hale", students), ["s6"]);
  assert.deepEqual(M.seenFitsFor("Zed Quill", students), [], "a name that fits nobody");
  const out = M.withSeenFits({ groups: [{ group: 0, nameSeen: "Gus Hale", responses: [] }, { group: 1, nameSeen: "illegible", responses: [] }] }, students);
  assert.deepEqual(out.groups, [{ group: 0, responses: [], seenFits: ["s6"] }, { group: 1, responses: [] }]);
  assert.ok(!JSON.stringify(out).includes("Gus"), "no name left in what is banked and saved");
  // The stored job result carries no name either.
  assert.deepEqual(N.withoutNameSeen({ groups: [{ group: 0, nameSeen: "Gus Hale", responses: [] }] }), { groups: [{ group: 0, responses: [] }] });
  const poll = readFileSync("app/api/analyze/[scanId]/route.ts", "utf8");
  assert.match(poll, /\.update\(\{ result: withoutNameSeen\(output\), build_ref_finish: buildStamp\(\) \}\)/);
  const scan = readFileSync("components/teacher-class-scan.tsx", "utf8");
  assert.match(scan, /return withSeenFits\(d\.result, students\);/);
  assert.match(scan, /return withSeenFits\(\(await resumeScan\(id\)\)\.result, students\);/);
});

test("a read name that fits neither the confirmed student nor the pile's read name is a mismatch", () => {
  const fits = (n) => M.seenFitsFor(n, students);
  assert.equal(M.pagesMayBelongElsewhere(fits("Gus Hale"), "s5", "Fay Gray", students), true, "the swap");
  assert.equal(M.pagesMayBelongElsewhere(fits("Fay Gray"), "s5", "Fay Gray", students), false);
  assert.equal(M.pagesMayBelongElsewhere(fits("Fay"), "s5", "", students), false, "a first name alone");
  assert.equal(M.pagesMayBelongElsewhere(fits("Fay Grey"), "s5", "", students), false, "a small misspelling");
  assert.equal(M.pagesMayBelongElsewhere(undefined, "s5", "Fay Gray", students), false, "no name read: no evidence either way");
  assert.equal(M.pagesMayBelongElsewhere(fits("Zed Quill"), "s5", "Fay Gray", students), false, "a name that fits nobody: no evidence");
  // The teacher re-matched a misread pile: both passes read the same student.
  assert.equal(M.pagesMayBelongElsewhere(fits("Gus Hale"), "s0", "Gus Hale", students), false);
});

const banked = M.withSeenFits({ groups: graded }, students).groups;

test("the recorded swap: the two students' answers are marked to check, nobody else's, nothing moved", () => {
  const rows = C.resolveScannedGroups(pageGroups, names, banked, ids, students);
  assert.deepEqual(rows.map((r) => r.seenFits), NAMES.map((_, g) => ["s" + paperOf(g)]));
  const result = C.applyScannedGroups(
    assessment, students, "c1",
    rows.map((r) => ({ studentId: r.studentId, name: r.name, pageUploadIds: r.pageUploadIds, responses: r.responses, detectedName: r.detectedName, seenFits: r.seenFits })),
    { today: "2026-11-02" },
  );
  const flagged = M.studentsToCheck(result.assessment);
  assert.deepEqual(flagged.sort(), ["s5", "s6"]);
  // Still where the grading put them: the teacher decides.
  assert.ok(result.assessment.responses.filter((r) => r.studentId === "s5").every((r) => r.answer.startsWith("Gus Hale")));
  assert.ok(result.assessment.responses.filter((r) => r.checkPages).every((r) => ["s5", "s6"].includes(r.studentId)));
});

function swapped() {
  const rows = C.resolveScannedGroups(pageGroups, names, banked, ids, students);
  return C.applyScannedGroups(assessment, students, "c1", rows.map((r) => ({ ...r })), { today: "2026-11-02" }).assessment;
}

test("Move these answers to...: onto a student with answers is a swap, with NEW ids; pages and place in the pile follow", () => {
  const a = swapped();
  assert.equal(M.moveIsSwap(a, "s6"), true);
  assert.deepEqual(M.moveCounts(a, "s5", "s6"), { from: 9, to: 9 });
  const fixed = M.moveAnswers(a, "s5", "s6");
  assert.ok(fixed.responses.filter((r) => r.studentId === "s5").every((r) => r.answer.startsWith("Fay Gray")));
  assert.ok(fixed.responses.filter((r) => r.studentId === "s6").every((r) => r.answer.startsWith("Gus Hale")));
  assert.deepEqual(fixed.studentUploadIds.s5, a.studentUploadIds.s6, "the photos go with the answers");
  assert.deepEqual(fixed.studentUploadIds.s6, a.studentUploadIds.s5);
  assert.deepEqual(M.studentsToCheck(fixed), [], "decided: the marks clear");
  assert.equal(fixed.responses.length, a.responses.length);
  const oldIds = new Set(a.responses.map((r) => r.id));
  const moved = fixed.responses.filter((r) => r.studentId === "s5" || r.studentId === "s6");
  assert.ok(moved.every((r) => !oldIds.has(r.id)), "every moved answer has a new id (responses_legacy_key)");
  assert.equal(new Set(fixed.responses.map((r) => r.id)).size, fixed.responses.length, "ids stay unique");
  assert.ok(fixed.responses.filter((r) => !["s5", "s6"].includes(r.studentId)).every((r) => oldIds.has(r.id)), "nobody else's change");
  // Undo: as it was, with fresh ids again.
  const back = M.undoMove(fixed, a, ["s5", "s6"]);
  assert.deepEqual(back.responses.filter((r) => r.studentId === "s5").map((r) => r.answer).sort(), a.responses.filter((r) => r.studentId === "s5").map((r) => r.answer).sort());
  assert.deepEqual(M.studentsToCheck(back).sort(), ["s5", "s6"], "and the marks back");
  // Onto a student with no answers: a move.
  const solo = { ...a, responses: a.responses.filter((r) => r.studentId !== "s6") };
  assert.equal(M.moveIsSwap(solo, "s6"), false);
  const movedOver = M.moveAnswers(solo, "s5", "s6");
  assert.equal(movedOver.responses.filter((r) => r.studentId === "s5").length, 0);
  assert.equal(movedOver.responses.filter((r) => r.studentId === "s6").length, 9);
  // "They're right" keeps them and clears the mark.
  assert.deepEqual(M.studentsToCheck(M.clearCheckPages(a, "s5")), ["s6"]);
});

const r = (id, studentId, answer, extra = {}) => ({ id, studentId, questionId: "q1", answer, finalAnswer: answer, correct: false, match: 0, misconception: "", confidence: 90, verified: true, ...extra });

test("Edit reading never leaves an answer in a group with other credit; an empty edit is refused", () => {
  const a = { ...assessment, responses: [
    r("r1", "s0", "Clementin", { match: 50 }),
    r("r2", "s1", "Clementine", { correct: true, match: 100 }), r("r3", "s2", "Clementine", { correct: true, match: 100 }),
    r("r4", "s3", "William", { match: 0 }), r("r5", "s4", "William", { match: 50 }),
  ] };
  // Read the same as an answer graded one way: it takes that credit.
  const joined = M.editWrittenAnswer(a, "r1", "  Clementine ");
  const one = joined.responses.find((x) => x.id === "r1");
  assert.equal(one.answer, "Clementine");
  assert.equal(one.finalAnswer, "Clementine");
  assert.equal(one.match, 100);
  assert.equal(one.correct, true);
  const g = W.groupAnswers(joined, "q1").find((x) => x.responseIds.includes("r1"));
  assert.ok(g.responseIds.every((id) => joined.responses.find((x) => x.id === id).match === 100), "its group has one credit");
  // Read the same as answers graded two different ways: on its own, undecided.
  const split = M.editWrittenAnswer(a, "r1", "William").responses.find((x) => x.id === "r1");
  assert.equal(split.gradedAlone, true);
  assert.equal(split.verified, false);
  // Read as something nobody else wrote: on its own, undecided.
  const alone = M.editWrittenAnswer(a, "r1", "Harriet").responses.find((x) => x.id === "r1");
  assert.equal(alone.gradedAlone, true);
  assert.equal(alone.verified, false);
  for (const groups of [W.groupAnswers(M.editWrittenAnswer(a, "r1", "William"), "q1"), W.groupAnswers(M.editWrittenAnswer(a, "r1", "Harriet"), "q1")])
    for (const grp of groups) assert.equal(new Set(grp.responseIds.map((id) => a.responses.find((x) => x.id === id)?.match ?? -1)).size <= 1 || grp.alone, true);
  // Empty is refused.
  assert.equal(M.editWrittenAnswer(a, "r1", "   "), null);
  assert.equal(M.editWrittenAnswer(a, "nope", "x"), null);
});

test("a move or swap is asked first and can be undone", () => {
  const review = readFileSync("components/teacher-review.tsx", "utf8");
  assert.match(review, /"Move " \+ plural\(counts\.from\) \+ " from " \+ nameOf\(fromId\) \+ " to " \+ nameOf\(to\) \+ "\?"/);
  assert.match(review, /<AlertDialogAction disabled=\{busy\} onClick=\{move\}>/);
  assert.match(review, /onClick=\{\(\) => setConfirming\(true\)\}/, "the button only asks");
  assert.match(review, /label: "Undo",\s*onClick: \(\) => void onSave\(undoMove\(latest\.current, before, pair\), "Put back as it was"\)/);
  assert.match(review, /A reading can’t be empty/);
});

test("Grade by question shows the mark, the move and the edit; the mark is saved", () => {
  const review = readFileSync("components/teacher-review.tsx", "utf8");
  assert.match(review, /Answers may belong to another page — check/);
  assert.match(review, /Move these answers to…/);
  assert.match(review, /<MixupPanel assessment=\{a\} students=\{students\} onSave=\{onSave\} busy=\{busy\} \/>/);
  assert.match(review, /Edit reading/);
  const scan = readFileSync("components/teacher-class-scan.tsx", "utf8");
  assert.match(scan, /detectedName: g\.detectedName,\s*seenFits: g\.seenFits,/, "the save carries both reads");
  const migration = readFileSync("supabase/migrations/20261104120000_response_check_pages.sql", "utf8");
  assert.match(migration, /add column if not exists check_pages boolean/);
  assert.match(migration, /''checkPages'', r\.check_pages/);
  assert.match(readFileSync("supabase/checks/check-pages-round-trip.sql", "utf8"), /ROLLED_BACK/);
});

// Review of #203, round 2.
test("a printed label read with the name is not part of it: \"Name: Fay Gray\" filed on Eli Ford still flags", () => {
  for (const read of ["Name: Fay Gray", "NAME - Fay Gray", "Name:Fay Gray", "Student: Fay Gray", "Student Name: Fay Gray", "name — Fay Gray"])
    assert.equal(N.usableNameSeen(read), "Fay Gray", JSON.stringify(read));
  assert.equal(M.pagesMayBelongElsewhere(M.seenFitsFor("Name: Fay Gray", students), "s4", "Eli Ford", students), true);
  assert.equal(M.pagesMayBelongElsewhere(M.seenFitsFor("Name: Fay Gray", students), "s5", "Fay Gray", students), false, "on her own pile it does not");
  for (const blank of ["Name:", "Name: ?", "Student: unreadable", "Name - "]) assert.equal(N.usableNameSeen(blank), "", JSON.stringify(blank));
  assert.equal(N.usableNameSeen("Namira Patel"), "Namira Patel", "a name that starts like the label is kept");
});

test("Undo after a move puts back only the two students' places in the pile; a reorder of others made since stays", () => {
  const order = ["s0", "s1", "s2", "s3", "s4", "s5", "s6"];
  const a = { ...assessment, studentOrder: order, responses: [
    { id: "r5", studentId: "s5", questionId: "q1", answer: "x", correct: false, match: 0, misconception: "", confidence: 90, verified: false },
    { id: "r6", studentId: "s6", questionId: "q1", answer: "y", correct: false, match: 0, misconception: "", confidence: 90, verified: false },
  ] };
  const moved = M.moveAnswers(a, "s5", "s6");
  assert.deepEqual(moved.studentOrder, ["s0", "s1", "s2", "s3", "s4", "s6", "s5"]);
  // Meanwhile the teacher moved s0 to the end of the pile.
  const reordered = { ...moved, studentOrder: ["s1", "s2", "s3", "s4", "s6", "s5", "s0"] };
  assert.deepEqual(M.undoMove(reordered, a, ["s5", "s6"]).studentOrder, ["s1", "s2", "s3", "s4", "s5", "s6", "s0"]);
  // A move onto a student with no answers, and a reorder of s5 itself since.
  const onto = M.moveAnswers(a, "s5", "s2");
  assert.deepEqual(onto.studentOrder, ["s0", "s1", "s5", "s3", "s4", "s2", "s6"]);
  const later = { ...onto, studentOrder: ["s3", "s0", "s1", "s5", "s4", "s2", "s6"] };
  assert.deepEqual(M.undoMove(later, a, ["s5", "s2"]).studentOrder, ["s3", "s0", "s1", "s2", "s4", "s5", "s6"]);
});

test("a model output that is not JSON never puts its text in an error message (stored on scans.error and app_events)", () => {
  assert.throws(() => A.parseModelOutput('Fay Gray wrote {"groups":[]}'), (e) => e instanceof SyntaxError && !/Fay|Gray|wrote/.test(String(e)));
  assert.deepEqual(A.parseModelOutput('{"groups":[]}'), { groups: [] });
  for (const f of ["app/api/analyze/route.ts", "app/api/analyze/[scanId]/route.ts", "lib/regression/runner.ts"]) {
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /JSON\.parse\(text\)/, f);
    assert.match(src, /parseModelOutput\(text\)/, f);
  }
});
