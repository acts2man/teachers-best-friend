// The Assessment Library (Ricky, 23 and 27 Oct 2026). Proven when a test with
// a confirmed answer key shows in the library -- grouped by course, courses
// and tests alphabetical -- and picking it for any class graded the same way
// links it to that class, puts that class on screen and lands on Student work;
// a class graded the other way cannot pick it, and nothing new is stored.
// scripts/browser-check/assessment-library.mjs clicks through it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);
function bundle(entry) {
  const r = buildSync({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", write: false, absWorkingDir: ROOT });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}
const L = bundle("lib/assessment-library.ts");

const test_ = (id, over = {}) => ({
  id, classId: "p1", title: "Test " + id, subject: "Math", grade: 7, framework: "Common Core",
  createdAt: "2026-10-01T00:00:00Z", status: "Ready", questions: [], responses: [], uploadIds: [],
  source: "ai", targetStandards: [], answerKeyVerified: true, ...over,
});
const ws = (assessments, classes) => ({
  classes: classes || [
    { id: "p1", name: "Period 1", grade: 7, framework: "Common Core", demo: false, gradingMode: "percentage" },
    { id: "p3", name: "Period 3", grade: 7, framework: "Common Core", demo: false, gradingMode: "percentage" },
    { id: "p5", name: "Period 5", grade: 7, framework: "Common Core", demo: false, gradingMode: "sbg" },
  ],
  students: [], lessons: [], assessments, activeClassId: "p1", settings: {},
});

test("only a test with a confirmed answer key is in the library", () => {
  assert.equal(L.inLibrary(test_("a")), true);
  assert.equal(L.inLibrary(test_("b", { answerKeyVerified: false })), false, "key not confirmed yet");
  assert.equal(L.inLibrary(test_("c", { answerKeyVerified: undefined })), false);
  assert.equal(L.inLibrary(test_("d", { answerKeyVerified: undefined, source: "sample" })), true, "the setup checklist's rule for sample tests");
  assert.equal(L.inLibrary(test_("e", { subject: "ELA", elaArea: "writing", rubric: [{ id: "r", name: "Ideas", max: 4 }] })), false, "writing has a rubric, not a key");
});

test("grouped by course, courses and tests alphabetical, from every class", () => {
  const w = ws([
    test_("z", { title: "Unit 2 quiz", classId: "p3" }),
    test_("y", { title: "unit 10 test" }),
    test_("x", { title: "Ratios check", grade: 10 }),
    test_("w", { title: "Main idea", subject: "ELA", grade: 7, elaArea: "reading" }),
    test_("v", { title: "Draft", answerKeyVerified: false }),
  ]);
  const got = L.libraryCourses(w).map((g) => [g.course, g.tests.map((t) => t.title)]);
  assert.deepEqual(got, [
    ["Grade 7 ELA", ["Main idea"]],
    ["Grade 7 Math", ["Unit 2 quiz", "unit 10 test"]],
    ["Grade 10 Math", ["Ratios check"]],
  ]);
});

test("picking a test for a class graded the same way links it and opens Student work there", () => {
  const w = ws([test_("t1")]);
  const next = L.pickFromLibrary(w, "t1", "p3");
  assert.ok(next);
  const t = next.assessments.find((a) => a.id === "t1");
  assert.equal(t.classId, "p1", "it still belongs to the class it was made in");
  assert.deepEqual(t.classIds, ["p3"]);
  assert.equal(next.activeClassId, "p3", "that class is the one on screen");
  assert.deepEqual(t.questions, w.assessments[0].questions, "questions and key are shared, not copied");
  assert.equal(next.assessments.length, 1, "no second copy of the test");
  assert.equal(L.libraryStudentWorkUrl("t1"), "/assessments?id=t1&tab=responses&from=library");
  // Picking it again for a class that already has it only switches class.
  const again = L.pickFromLibrary(next, "t1", "p3");
  assert.deepEqual(again.assessments.find((a) => a.id === "t1").classIds, ["p3"]);
});

const q = (n, over = {}) => ({ id: "q" + n, number: n, text: "Q" + n, answer: "4", standard: "7.RP.A.1", verified: true, excluded: false, points: 1, ...over });

test("the library holds only a confirmed key with nothing left to review (Ricky, 5 Nov 2026)", () => {
  const ready = test_("r", { questions: [q(1), q(2)], targetStandards: ["7.RP.A.1"] });
  assert.equal(L.questionsToReview(ready), 0);
  assert.equal(L.inLibrary(ready), true);
  assert.equal(L.libraryLandingUrl(ready), "/assessments?id=r&tab=responses&from=library");
  // A confirmed key whose questions are not all reviewed KEEPS its key but
  // stays out of the library until the review is finished.
  const left = test_("s", { questions: [q(1), q(2, { verified: false }), q(3, { standard: "" })], targetStandards: ["7.RP.A.1"] });
  assert.equal(L.keyConfirmed(left), true, "the key stays confirmed");
  assert.equal(L.questionsToReview(left), 2);
  assert.equal(L.inLibrary(left), false, "but it is not in the library");
  assert.equal(L.libraryLandingUrl(left), "/assessments?id=s&tab=questions", "picking would land on the review, not a scan");
  // So libraryCourses leaves it out.
  const courses = L.libraryCourses(ws([ready, left]));
  const titles = courses.flatMap((c) => c.tests.map((t) => t.title));
  assert.deepEqual(titles, ["Test r"], "only the fully-reviewed test is listed");
});

test("a question with no answer yet also counts as to review, and a key with none confirmed is never in the library", () => {
  assert.equal(L.questionsToReview(test_("x", { questions: [q(1), q(2, { answer: "" })] })), 1);
  assert.equal(L.inLibrary(test_("y", { questions: [q(1, { verified: false })], answerKeyVerified: false })), false);
  assert.equal(L.inLibrary(test_("z", { questions: [q(1)] })), true, "confirmed + all reviewed");
});

test("the answer key confirm is gated on on-screen answers and reviewed standards, not saved answers (#214 review)", () => {
  const key = fs.readFileSync("components/teacher-answer-key.tsx", "utf8");
  // Blank answers are counted from the on-screen `answers` map (typed or read),
  // never from the saved `q.answer` -- the key is only written on Confirm, so a
  // typed-in key must be confirmable.
  assert.match(key, /answersBlank = questions\.filter\(\(q\) => !\(answers\[q\.id\] \|\| ""\)\.trim\(\)\)\.length/);
  assert.match(key, /const standardsToReview = questions\.filter\(\(q\) => !q\.verified \|\| !q\.standard\)\.length/);
  assert.match(key, /if \(unsettled\.length \|\| standardsToReview > 0 \|\| !complete\) return;/, "confirm() is blocked on the on-screen gate");
  assert.match(key, /disabled=\{working \|\| checking \|\| !complete \|\| unsettled\.length > 0 \|\| standardsToReview > 0\}/, "the button too");
  assert.doesNotMatch(key, /questionsToReview/, "the answer-key tab no longer gates on saved answers");
  // The reason text names exactly what is missing.
  assert.match(key, /answers blank/);
  assert.match(key, /standards to review/);
  // The Assessments view still surfaces the saved-state count on a
  // confirmed-but-unreviewed test (there the answers are saved).
  const view = fs.readFileSync("components/teacher-assessments.tsx", "utf8");
  assert.match(view, /"Key confirmed · " \+ questionsToReview\(item\) \+ " to review"/);
});

test("a class graded the other way cannot pick it", () => {
  const w = ws([test_("t1")]);
  assert.deepEqual(L.libraryClassesFor(w, w.assessments[0]).map((c) => c.id), ["p1", "p3"]);
  assert.equal(L.pickFromLibrary(w, "t1", "p5"), null);
  const sbg = ws([test_("t2", { gradingMode: "sbg" })]);
  assert.deepEqual(L.libraryClassesFor(sbg, sbg.assessments[0]).map((c) => c.id), ["p1", "p5"], "Standards-Based: its own class and the 0–4 class");
  assert.equal(L.pickFromLibrary(ws([test_("t3", { answerKeyVerified: false })]), "t3", "p3"), null, "not in the library");
});

test("the library is in the menu and its own page, and New assessment points to it", () => {
  const app = fs.readFileSync(path.join(ROOT, "components/teacher-app.tsx"), "utf8");
  assert.match(app, /\{ id: "library", label: "Assessment Library"/);
  assert.match(app, /view === "library" \? \(\s*<LibraryView \/>/);
  assert.match(fs.readFileSync(path.join(ROOT, "app/[view]/page.tsx"), "utf8"), /"library",/);
  const page = fs.readFileSync(path.join(ROOT, "components/teacher-library.tsx"), "utf8");
  assert.match(page, /go\(libraryLandingUrl\(a\)\)/, "picking one lands on Student work (or the review it still needs)");
  assert.match(page, /upload it again as a new test/);
  assert.match(fs.readFileSync(path.join(ROOT, "components/teacher-scan.tsx"), "utf8"), /go\("\/library"\)/);
  const view = fs.readFileSync(path.join(ROOT, "components/teacher-assessments.tsx"), "utf8");
  assert.match(view, /params\.get\("from"\) === "library"/, "it lands scrolled to the upload");
  assert.match(view, /a\.responses\.filter\(\(r\) => students\.some\(\(s\) => s\.id === r\.studentId\)\)/, "Student work counts this class's students only");
});

test("nothing new is stored: the library rides fields sync_workspace already saves", () => {
  const lib = fs.readFileSync(path.join(ROOT, "lib/assessment-library.ts"), "utf8");
  const guard = fs.readFileSync(path.join(ROOT, "tests/workspace-persistence-guard.test.mjs"), "utf8");
  for (const f of ["classIds", "answerKeyVerified"]) assert.match(guard, new RegExp('"' + f + '"'), f + " is on the persisted list");
  assert.doesNotMatch(lib, /library[A-Z]\w*:\s/, "no new workspace field");
});
