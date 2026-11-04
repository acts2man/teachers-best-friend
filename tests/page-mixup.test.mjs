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
});

test("a read name that fits neither the confirmed student nor the pile's read name is a mismatch", () => {
  assert.equal(M.pagesMayBelongElsewhere("Gus Hale", "Fay Gray", "Fay Gray"), true, "the swap");
  assert.equal(M.pagesMayBelongElsewhere("Fay Gray", "Fay Gray", "Fay Gray"), false);
  assert.equal(M.pagesMayBelongElsewhere("Fay", "Fay Gray", ""), false, "a first name alone");
  assert.equal(M.pagesMayBelongElsewhere("Fay Grey", "Fay Gray", ""), false, "a small misspelling");
  assert.equal(M.pagesMayBelongElsewhere("", "Fay Gray", "Fay Gray"), false, "no name read: no evidence either way");
  // The teacher re-matched a misread pile: the grading pass agrees with the
  // name pass, so the pages were read as grouped.
  assert.equal(M.pagesMayBelongElsewhere("Fae Grai", "Gus Hale", "Fae Grai"), false);
});

test("the recorded swap: the two students' answers are marked to check, nobody else's, nothing moved", () => {
  const rows = C.resolveScannedGroups(pageGroups, names, graded, ids, students);
  assert.deepEqual(rows.map((r) => r.nameSeen), NAMES.map((_, g) => NAMES[paperOf(g)]));
  const result = C.applyScannedGroups(
    assessment, students, "c1",
    rows.map((r) => ({ studentId: r.studentId, name: r.name, pageUploadIds: r.pageUploadIds, responses: r.responses, detectedName: r.detectedName, nameSeen: r.nameSeen })),
    { today: "2026-11-02" },
  );
  const flagged = M.studentsToCheck(result.assessment);
  assert.deepEqual(flagged.sort(), ["s5", "s6"]);
  // Still where the grading put them: the teacher decides.
  assert.ok(result.assessment.responses.filter((r) => r.studentId === "s5").every((r) => r.answer.startsWith("Gus Hale")));
  assert.ok(result.assessment.responses.filter((r) => r.checkPages).every((r) => ["s5", "s6"].includes(r.studentId)));
});

function swapped() {
  const rows = C.resolveScannedGroups(pageGroups, names, graded, ids, students);
  return C.applyScannedGroups(assessment, students, "c1", rows.map((r) => ({ ...r })), { today: "2026-11-02" }).assessment;
}

test("Move these answers to...: onto a student with answers is a swap, pages and place in the pile follow", () => {
  const a = swapped();
  assert.equal(M.moveIsSwap(a, "s6"), true);
  const fixed = M.moveAnswers(a, "s5", "s6");
  assert.ok(fixed.responses.filter((r) => r.studentId === "s5").every((r) => r.answer.startsWith("Fay Gray")));
  assert.ok(fixed.responses.filter((r) => r.studentId === "s6").every((r) => r.answer.startsWith("Gus Hale")));
  assert.deepEqual(fixed.studentUploadIds.s5, a.studentUploadIds.s6, "the photos go with the answers");
  assert.deepEqual(fixed.studentUploadIds.s6, a.studentUploadIds.s5);
  assert.deepEqual(M.studentsToCheck(fixed), [], "decided: the marks clear");
  assert.equal(fixed.responses.length, a.responses.length);
  assert.deepEqual(new Set(fixed.responses.map((r) => r.id)), new Set(a.responses.map((r) => r.id)));
  // Onto a student with no answers: a move.
  const solo = { ...a, responses: a.responses.filter((r) => r.studentId !== "s6") };
  assert.equal(M.moveIsSwap(solo, "s6"), false);
  const moved = M.moveAnswers(solo, "s5", "s6");
  assert.equal(moved.responses.filter((r) => r.studentId === "s5").length, 0);
  assert.equal(moved.responses.filter((r) => r.studentId === "s6").length, 9);
  // "They're right" keeps them and clears the mark.
  assert.deepEqual(M.studentsToCheck(M.clearCheckPages(a, "s5")), ["s6"]);
});

test("Edit reading: the teacher corrects what an answer was read as; credit is left alone", () => {
  const a = { ...assessment, responses: [{ id: "r1", studentId: "s0", questionId: "q1", answer: "Clementin", finalAnswer: "Clementin", correct: false, match: 50, misconception: "", confidence: 80, verified: true }] };
  const next = M.editWrittenAnswer(a, "r1", "  Clementine ");
  assert.equal(next.responses[0].answer, "Clementine");
  assert.equal(next.responses[0].finalAnswer, "Clementine", "it groups with the students who wrote the same");
  assert.equal(next.responses[0].match, 50);
  assert.equal(next.responses[0].verified, true);
});

test("Grade by question shows the mark, the move and the edit; the mark is saved", () => {
  const review = readFileSync("components/teacher-review.tsx", "utf8");
  assert.match(review, /Answers may belong to another page — check/);
  assert.match(review, /Move these answers to…/);
  assert.match(review, /<MixupPanel assessment=\{a\} students=\{students\} onSave=\{onSave\} busy=\{busy\} \/>/);
  assert.match(review, /Edit reading/);
  const scan = readFileSync("components/teacher-class-scan.tsx", "utf8");
  assert.match(scan, /detectedName: g\.detectedName,\s*nameSeen: g\.nameSeen,/, "the save carries both reads");
  const migration = readFileSync("supabase/migrations/20261104120000_response_check_pages.sql", "utf8");
  assert.match(migration, /add column if not exists check_pages boolean/);
  assert.match(migration, /''checkPages'', r\.check_pages/);
  assert.match(readFileSync("supabase/checks/check-pages-round-trip.sql", "utf8"), /ROLLED_BACK/);
});
