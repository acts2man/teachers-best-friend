// RULE R1: a save always sends every class's students, assessments and
// responses -- sync_workspace deletes whatever the payload leaves out.
// docs/system-map.md, rule R1. Incident: 12 Oct 2026, fixed in #123.
//
// A pilot teacher with five classes saved a class scan in one of them; the
// panel had saved `students: result.students` (the ACTIVE class only), and
// sync_workspace deleted the other four classes' students and, through the
// foreign key, every response they had.
//
// This test is a fuzz over multi-class workspaces. It builds the payload the
// way the panel's saveAll builds it (pinned to the component source below),
// runs it through a model of sync_workspace's delete rules, and checks that
// nothing outside the scanned students' rows on the scanned assessment changed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { bundle, rng, RUNS } from "./lib/bundle.mjs";

const C = bundle("lib/teacher-class-scan.ts");
const D = bundle("lib/teacher-data.ts");

/**
 * What survives sync_workspace(payload), per its delete statements: a row
 * whose id the payload does not name is deleted, and a response goes with its
 * student, its assessment or its question (foreign keys, and the insert's
 * inner joins). Returns the surviving ids.
 */
function survivesSync(payload) {
  const students = new Set(payload.students.map((s) => s.id));
  const assessments = new Set(payload.assessments.map((a) => a.id));
  const responses = new Set();
  for (const a of payload.assessments) {
    const questions = new Set(a.questions.map((q) => q.id));
    for (const r of a.responses)
      if (students.has(r.studentId) && questions.has(r.questionId)) responses.add(a.id + "/" + r.id);
  }
  return { students, assessments, responses };
}

function workspace(R) {
  const classes = Array.from({ length: R.int(2, 5) }, (_, i) => ({ id: "class-" + i, name: "Period " + i, grade: 6, framework: "California", demo: false }));
  const students = [];
  const assessments = [];
  let n = 0;
  for (const c of classes) {
    const roster = Array.from({ length: R.int(0, 6) }, () => ({ id: "s" + n, classId: c.id, name: "Student " + n++, color: "#000", evidence: [], notes: "" }));
    students.push(...roster);
    for (let k = 0; k < R.int(1, 3); k++) {
      const id = c.id + "-quiz-" + k;
      const questions = Array.from({ length: R.int(1, 4) }, (_, q) => ({
        id: id + "-q" + q, number: q + 1, text: "Q", passage: "", answer: String(q), standard: "6.EE.1", secondary: "", skill: "",
        dok: 1, alignment: 100, confidence: 100, level: "On grade", reasoning: "", verified: true, excluded: false,
      }));
      const responses = [];
      for (const s of roster)
        for (const q of questions)
          if (R.chance(0.7))
            responses.push({ id: "r-" + s.id + "-" + q.id, studentId: s.id, questionId: q.id, answer: "x", correct: R.chance(0.5), confidence: 90, verified: R.chance(0.5), misconception: "" });
      assessments.push({
        id, classId: c.id, title: "Quiz", subject: "Math", grade: 6, framework: "California", createdAt: "", status: "Ready",
        questions, responses, uploadIds: [], source: "manual", targetStandards: ["6.EE.1"], studentUploadIds: {},
      });
    }
  }
  // Shuffle the roster so classes interleave, as a real roster does.
  return { classes, activeClassId: R.pick(classes).id, students: R.shuffle(students), assessments, lessons: [], resources: [], customStandards: [], groups: [] };
}

function scanGroups(R, a, classStudents) {
  const groups = [];
  for (let g = 0; g < R.int(1, 6); g++) {
    const known = classStudents.length && R.chance(0.6) ? R.pick(classStudents).id : null;
    groups.push({
      studentId: R.chance(0.1) ? "removed-since" : known, // a student deleted after matching
      name: known ? "Matched" : "New Kid " + g,
      pageUploadIds: ["page-" + g],
      responses: a.questions.filter(() => R.chance(0.8)).map((q) => ({ questionId: q.id, answer: "7", verdict: R.pick(["match", "other", "blank", "unsure"]), finalAnswer: "7" })),
    });
  }
  return groups;
}

function check(seed, keep = C.keepOtherClassStudents) {
  const R = rng(seed);
  const w = workspace(R);
  const active = w.activeClassId;
  const classStudents = w.students.filter((s) => s.classId === active);
  const inClass = w.assessments.filter((a) => a.classId === active);
  const a = R.pick(inClass);
  const groups = scanGroups(R, a, classStudents);
  const result = C.applyScannedGroups(a, classStudents, active, groups);
  const payload = {
    ...w,
    students: D.reconcileEvidence(keep(w.students, classStudents, result.students), result.assessment),
    assessments: w.assessments.map((x) => (x.id === a.id ? result.assessment : x)),
  };
  const kept = survivesSync(payload);
  const scanned = new Set(groups.map((g) => g.studentId).filter(Boolean));
  for (const s of w.students) assert.ok(kept.students.has(s.id), `seed ${seed}: student ${s.id} (${s.classId}) deleted by the save`);
  for (const x of w.assessments) {
    assert.ok(kept.assessments.has(x.id), `seed ${seed}: assessment ${x.id} deleted by the save`);
    for (const r of x.responses) {
      // The only responses a scan may replace: the scanned students' answers
      // on the scanned assessment.
      if (x.id === a.id && scanned.has(r.studentId)) continue;
      assert.ok(kept.responses.has(x.id + "/" + r.id), `seed ${seed}: response ${r.id} (${x.id}) deleted by the save`);
    }
  }
  for (const s of result.newStudents) assert.ok(kept.students.has(s.id), `seed ${seed}: the new student ${s.id} was not saved`);
  const ids = payload.students.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, `seed ${seed}: a student is sent twice`);
}

test(`a class scan save keeps every other class's students, assessments and responses (${RUNS} workspaces)`, () => {
  for (let seed = 1; seed <= RUNS; seed++) check(seed);
});

test("the old save (active class only) fails this check -- the #123 bug, reproduced", () => {
  // The panel before #123 saved result.students as the whole roster.
  const oldSave = (_all, _before, after) => after;
  assert.throws(() => {
    for (let seed = 1; seed <= RUNS; seed++) check(seed, oldSave);
  }, /deleted by the save/);
});

test("the panel's saveAll still builds its payload the way this test models it", () => {
  const src = readFileSync("components/teacher-class-scan.tsx", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  const save = src.slice(src.indexOf("async function saveAll("));
  const body = save.slice(0, save.indexOf("setSaving(false)"));
  assert.match(body, /applyScannedGroups\(\s*a,\s*students,\s*classroom\.id,/);
  assert.match(body, /\.\.\.w,/, "the save starts from the WHOLE workspace");
  assert.match(body, /students:\s*reconcileEvidence\(\s*keepOtherClassStudents\(\s*w\.students,\s*students,\s*result\.students\s*\),\s*result\.assessment,?\s*\)/);
  assert.match(body, /assessments:\s*w\.assessments\.map\(\(x\)\s*=>\s*\(x\.id === a\.id \? result\.assessment : x\)\)/);
});

test("no other save hands sync_workspace the context's one-class `students`", () => {
  // useTeacher().students is the ACTIVE class only (components/teacher-app.tsx).
  // Any `save({...w, students: <something built from it>})` repeats #123. Every
  // students: key inside a save( call must come from w.students or go through
  // keepOtherClassStudents.
  // The trap is the bare context variable `students` (one class). It is
  // fine only as keepOtherClassStudents's `before` argument.
  const usesClassOnly = (v) =>
    /(?<![.\w$])students\b|\bresult\.students\b/.test(
      v.replace(/keepOtherClassStudents\(\s*w\.students,\s*students,\s*result\.students\s*\)/g, "keepOtherClassStudents(ALL, BEFORE, AFTER)"),
    );
  let checked = 0;
  for (const f of readdirSync("components").filter((x) => x.endsWith(".tsx"))) {
    const src = readFileSync("components/" + f, "utf8").replace(/\/\/.*$/gm, "");
    for (const m of src.matchAll(/save\(\s*\{\s*\.\.\.w,([\s\S]*?)\n\s*\}/g)) {
      const s = /\bstudents:\s*([\s\S]{0,160})/.exec(m[1]);
      if (!s) continue;
      let value = s[1].replace(/"[^"]*"|'[^']*'|`[^`]*`/g, "\"\"").replace(/\s+/g, " ");
      // A bare variable: judge the expression it was built from.
      const name = /^\s*([A-Za-z_$][\w$]*)\s*,/.exec(value);
      if (name) {
        const def = new RegExp(`(?:const|let)\\s+${name[1]}\\s*=\\s*([^\\n]+)`).exec(src);
        if (def) value = def[1];
      }
      checked++;
      assert.ok(!usesClassOnly(value.split(/,\s*(?:assessments|classes|groups|lessons|resources|customStandards|settings|activeClassId)\s*:/)[0]), `${f}: a save sends students: ${value.slice(0, 80)}`);
    }
  }
  assert.ok(checked >= 3, `only ${checked} roster saves found: the scan above has stopped matching`);
});

