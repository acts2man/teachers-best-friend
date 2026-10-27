// School year + date given (27 Oct 2026). Proven when: a school year runs
// 1 July to 30 June and is stored as the year it starts; the teacher picks it
// at sign-up (the current one by default) and can change it in Settings, and
// both save; a test's date given is set to the day its class set is graded
// (never over one already set), can be edited on the test, and is read as
// the day the test was created when it was never recorded; and the migration
// patches both workspace functions with a rolled-back check. Nothing past is
// deleted or hidden: no code here filters a test out.
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
const Y = bundle("lib/school-year.ts");
const { applyScannedGroups } = bundle("lib/teacher-class-scan.ts");

test("a school year runs July to June and is named like 2026–27", () => {
  assert.equal(Y.schoolYearOf(new Date(2026, 9, 27)), 2026, "October 2026 is 2026–27");
  assert.equal(Y.schoolYearOf(new Date(2027, 5, 30)), 2026, "30 June 2027 is still 2026–27");
  assert.equal(Y.schoolYearOf(new Date(2026, 6, 1)), 2026, "1 July starts the new year");
  assert.equal(Y.schoolYearOf(new Date(2026, 5, 30)), 2025);
  assert.equal(Y.schoolYearLabel(2026), "2026–27");
  assert.equal(Y.schoolYearLabel(2099), "2099–00");
  assert.deepEqual(Y.schoolYearOptions(new Date(2026, 9, 27)), [2025, 2026, 2027]);
  const settings = { teacherName: "", school: "", reduceMotion: false };
  assert.equal(Y.teacherSchoolYear({ settings }, new Date(2026, 9, 27)), 2026, "none chosen: the current one");
  assert.equal(Y.teacherSchoolYear({ settings: { ...settings, schoolYear: 2025 } }, new Date(2026, 9, 27)), 2025);
  assert.equal(Y.teacherSchoolYear({ settings: { ...settings, schoolYear: "2025" } }, new Date(2026, 9, 27)), 2026, "junk is ignored");
});

test("a date given is a real day; a test without one reads the day it was created", () => {
  assert.ok(Y.isDateString("2026-10-21"));
  assert.ok(!Y.isDateString("2026-02-31") && !Y.isDateString("10/21/2026") && !Y.isDateString(""));
  assert.equal(Y.dateGivenOf({ dateGiven: "2026-10-21", createdAt: "2026-09-01T12:00:00Z" }), "2026-10-21");
  assert.equal(Y.dateGivenOf({ createdAt: "2026-09-01T12:00:00Z" }), Y.localDateString(new Date("2026-09-01T12:00:00Z")));
  assert.ok(Y.givenInSchoolYear({ dateGiven: "2026-10-21", createdAt: "" }, 2026));
  assert.ok(!Y.givenInSchoolYear({ dateGiven: "2026-06-30", createdAt: "" }, 2026));
  assert.equal(Y.daysSinceGiven({ dateGiven: "2026-09-27", createdAt: "" }, new Date(2026, 9, 27, 15)), 30);
});

const quiz = (extra = {}) => ({
  id: "quiz-1", classId: "c1", title: "Quiz", subject: "Math", grade: 6, framework: "California", createdAt: "2026-09-01T12:00:00Z", status: "Ready",
  questions: [{ id: "q1", number: 1, text: "1+1", passage: "", answer: "2", standard: "6.EE.1", secondary: "", skill: "", dok: 1, alignment: 100, confidence: 100, level: "", reasoning: "", verified: true, excluded: false }],
  responses: [], uploadIds: [], source: "manual", targetStandards: ["6.EE.1"], studentUploadIds: {}, ...extra,
});
const students = [{ id: "s1", classId: "c1", name: "Student One", color: "#000", evidence: [], notes: "" }];
const scanned = [{ studentId: "s1", name: "Student One", pageUploadIds: ["page-1"], responses: [{ questionId: "q1", answer: "2", verdict: "match", finalAnswer: "2" }] }];

test("grading a class set sets the date given to that day, never over one already set", () => {
  const first = applyScannedGroups(quiz(), students, "c1", scanned, { today: "2026-10-27" });
  assert.equal(first.assessment.dateGiven, "2026-10-27");
  const kept = applyScannedGroups(quiz({ dateGiven: "2026-10-20" }), students, "c1", scanned, { today: "2026-10-27" });
  assert.equal(kept.assessment.dateGiven, "2026-10-20", "the teacher's day stays");
  const none = applyScannedGroups(quiz(), students, "c1", [], { today: "2026-10-27" });
  assert.equal(none.assessment.dateGiven, undefined, "nothing graded, no date");
});

test("the test page edits the date given; Settings and sign-up choose the school year; the save keeps both", () => {
  const page = readFileSync("components/teacher-assessments.tsx", "utf8");
  assert.match(page, /type="date"\s+aria-label="Date given"\s+value=\{dateGivenOf\(a\)\}/);
  assert.match(page, /\{ \.\.\.x, dateGiven: day \}/);
  const settings = readFileSync("components/teacher-planning.tsx", "utf8");
  assert.match(settings, /label="School year"\s+value=\{String\(teacherSchoolYear\(w\)\)\}/);
  assert.match(settings, /settings: \{ \.\.\.w\.settings, schoolYear: Number\(v\) \}/);
  const login = readFileSync("app/login/page.tsx", "utf8");
  assert.match(login, /useState\(\(\) => currentSchoolYear\(\)\)/, "the current one unless they change it");
  assert.match(login, /data: \{ school_year: schoolYear \}/);
  const route = readFileSync("app/api/workspace/route.ts", "utf8");
  assert.match(route, /schoolYear: z\.number\(\)\.int\(\)\.min\(2000\)\.max\(2100\)\.optional\(\),/);
  assert.match(route, /if \(!saved\) saved = await initializeWorkspace\(id, await firstWorkspace\(id\)\);/);
  assert.match(route, /validSchoolYear\(data\?\.user\?\.user_metadata\?\.school_year\)/);
  // The class set's grading passes the day.
  assert.match(readFileSync("lib/teacher-class-scan.ts", "utf8"), /today = localDateString\(\),/);
});

test("the migration: a date column, both functions patched exactly once, nothing existing changed", () => {
  const sql = readFileSync("supabase/migrations/20261027140000_assessment_date_given.sql", "utf8");
  assert.doesNotMatch(sql, /\bdrop\b|\bdelete\b|\bupdate public\./i);
  assert.match(sql, /add column if not exists date_given date;/);
  assert.match(sql, /raise exception 'date_given migration: % fragment found % times, expected 1: %'/);
  assert.match(sql, /then public\.safe_date\(a->>''dateGiven''\) end,/);
  assert.match(sql, /''dateGiven'', to_char\(a\.date_given, ''YYYY-MM-DD''\),/);
  assert.match(sql, /'student_order = excluded\.student_order, grading_mode = excluded\.grading_mode,'/, "a fragment the classes patch cannot also match");
  const check = readFileSync("supabase/checks/date-given-school-year-round-trip.sql", "utf8");
  for (const k of ["a0=", "a1=", "a2=", "schoolYear=", "grades_unchanged="]) assert.ok(check.includes(k), k);
  assert.match(check, /raise exception 'ROLLED_BACK/);
});
