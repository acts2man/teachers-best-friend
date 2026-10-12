// Saving a class scan deleted every student in the teacher's other classes.
//
// The class-scan panel works from the context's `students`, which is the
// ACTIVE class only (components/teacher-app.tsx filters w.students by
// classroom.id). applyScannedGroups hands back `[...students, ...newStudents]`,
// and the save wrote that straight over `w.students`. sync_workspace deletes
// any student the payload no longer names, and their responses go with them.
//
// Found on production 12 Oct 2026: a pilot teacher with five classes saved a
// class scan in one of them at 18:42:09 UTC; afterwards that class held its 6
// students and the other four held none, and the graded responses on every
// assessment in those classes were gone. A teacher with one class never sees
// it, which is why it survived since the app was imported.
//
// These run the real lib/teacher-class-scan.ts. The first test reproduces the
// old save so that, if the helper were ever reverted to a pass-through, this
// file says exactly what that costs.
import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { readFileSync } from "node:fs";

function bundle(path) {
  const result = buildSync({ entryPoints: [path], bundle: true, platform: "node", format: "cjs", write: false });
  const shim = { exports: {} };
  new Function("module", "exports", result.outputFiles[0].text)(shim, shim.exports);
  return shim.exports;
}
const { applyScannedGroups, keepOtherClassStudents } = bundle("lib/teacher-class-scan.ts");

const student = (id, name, classId) => ({ id, classId, name, color: "#000", evidence: [], notes: "" });

function assessment(id, classId) {
  return {
    id, classId, title: "Quiz", subject: "Math", grade: 6, framework: "California", createdAt: "", status: "Ready",
    questions: [{ id: id + "-q1", number: 1, text: "1+1", passage: "", answer: "2", standard: "6.EE.1", secondary: "", skill: "", dok: 1, alignment: 100, confidence: 100, level: "On grade", reasoning: "", verified: true, excluded: false }],
    responses: [], uploadIds: [], source: "manual", targetStandards: ["6.EE.1"], studentUploadIds: {},
  };
}

// Two classes, the way a teacher with more than one period has them. Demo-style
// placeholder names only.
function workspace() {
  return {
    activeClassId: "period-1",
    classes: [
      { id: "period-1", name: "Period 1", grade: 6, framework: "California" },
      { id: "period-2", name: "Period 2", grade: 6, framework: "California" },
    ],
    students: [
      student("p1-a", "Student One", "period-1"),
      student("p2-a", "Student Two", "period-2"),
      student("p1-b", "Student Three", "period-1"),
      student("p2-b", "Student Four", "period-2"),
    ],
    assessments: [assessment("quiz-1", "period-1"), assessment("quiz-2", "period-2")],
  };
}

const scanned = (studentId, name) => ({
  studentId, name, pageUploadIds: ["page-" + name],
  responses: [{ questionId: "quiz-1-q1", answer: "2", verdict: "match", finalAnswer: "2" }],
});

// What the panel has: the active class's students only.
const activeClass = (w) => w.students.filter((s) => s.classId === w.activeClassId);

test("reproduces the bug: the old save drops every student in the other class", () => {
  const w = workspace();
  const classStudents = activeClass(w);
  const result = applyScannedGroups(w.assessments[0], classStudents, "period-1", [scanned("p1-a", "Student One")]);
  // The old save: `students: result.students`.
  const saved = result.students.map((s) => s.id).sort();
  assert.deepEqual(saved, ["p1-a", "p1-b"], "only the active class survives the old save");
});

test("a class scan keeps every student in the teacher's other classes", () => {
  const w = workspace();
  const classStudents = activeClass(w);
  const result = applyScannedGroups(w.assessments[0], classStudents, "period-1", [
    scanned("p1-a", "Student One"),
    scanned(null, "Student Five"), // a new student created by the scan
  ]);
  const saved = keepOtherClassStudents(w.students, classStudents, result.students);
  const ids = saved.map((s) => s.id);
  for (const s of w.students) assert.ok(ids.includes(s.id), s.id + " is still in the workspace");
  assert.equal(saved.length, w.students.length + 1, "plus the one new student, and nothing twice");
  assert.equal(new Set(ids).size, ids.length, "no student appears twice");
  const created = result.newStudents[0];
  assert.ok(ids.includes(created.id), "the student the scan created is saved");
  assert.equal(saved.find((s) => s.id === created.id).classId, "period-1");
});

test("other classes' students are passed through untouched and in place", () => {
  const w = workspace();
  const classStudents = activeClass(w);
  const result = applyScannedGroups(w.assessments[0], classStudents, "period-1", [scanned("p1-b", "Student Three")]);
  const saved = keepOtherClassStudents(w.students, classStudents, result.students);
  // Order of the existing roster is kept, so nothing reshuffles on screen.
  assert.deepEqual(saved.map((s) => s.id), ["p1-a", "p2-a", "p1-b", "p2-b"]);
  for (const id of ["p2-a", "p2-b"])
    assert.equal(saved.find((s) => s.id === id), w.students.find((s) => s.id === id), id + " is the same object");
});

test("an active-class student the scan updated is saved in its updated form", () => {
  const w = workspace();
  const classStudents = activeClass(w);
  const updated = classStudents.map((s) => (s.id === "p1-a" ? { ...s, notes: "changed" } : s));
  const saved = keepOtherClassStudents(w.students, classStudents, updated);
  assert.equal(saved.find((s) => s.id === "p1-a").notes, "changed");
});

test("the class-scan save goes through keepOtherClassStudents", () => {
  // The panel is a client component that needs a camera and a session to
  // drive end to end; this pins the one line that decides what is saved.
  const src = readFileSync("components/teacher-class-scan.tsx", "utf8");
  const save = src.slice(src.indexOf("const result = applyScannedGroups("));
  // Comments stripped first, so a commented-out correct line beside a live
  // `students: result.students` cannot pass.
  const call = save
    .slice(0, save.indexOf("setSaving(false)"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(call, /students:\s*result\.students/);
  assert.match(call, /students:\s*reconcileEvidence\(\s*keepOtherClassStudents\(\s*w\.students,\s*students,\s*result\.students\s*\)/);
});
