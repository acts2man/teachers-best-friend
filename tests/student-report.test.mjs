// The printable student report (docs/design/super-grids.md section 4; Ricky,
// 22 and 27 Oct 2026). Proven when the report, built in the browser with no
// AI call, holds this student's super grid with the class's average per
// cluster as a number, their common error types and the Standard Tracker for
// the standards the teacher picked -- and NO other student's name, score or
// answer, even where a test title, an evidence source or the teacher's notes
// name a classmate; and the teacher's notes are left out unless asked for.
// Made-up names and data only.
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
const R = bundle("lib/student-report.ts");
const [E1, E2] = bundle("lib/error-types.ts").errorTypesFor("Math");

const NOW = new Date(2026, 9, 27, 12);
const q = (id, standard, dok) => ({ id, number: 1, text: "", passage: "", answer: "", standard, secondary: "", skill: "", dok, alignment: 90, confidence: 90, level: "", reasoning: "", verified: true, excluded: false });
const r = (studentId, questionId, match, extra = {}) => ({ id: studentId + questionId, studentId, questionId, answer: studentId + " wrote ANSWER-" + studentId, correct: match === 100, match, misconception: "", confidence: 90, verified: true, ...extra });
const base = { classId: "c1", subject: "Math", grade: 7, framework: "California", createdAt: "2026-09-01T12:00:00Z", status: "Ready", source: "manual", targetStandards: [], answerKeyVerified: true, uploadIds: [] };
const t1 = { ...base, id: "t1", title: "Zed Quill's retake on ratios", dateGiven: "2026-10-20",
  questions: [q("a", "7.RP.1", 1), q("b", "7.RP.2", 2), q("c", "7.EE.1", 3)],
  responses: [
    r("s1", "a", 100), r("s1", "b", 50, { errorType: E1 }), r("s1", "c", 0, { errorType: E2 }),
    r("s2", "a", 13), r("s2", "b", 13, { errorType: E2 }), r("s2", "c", 13),
    r("s3", "a", 41), r("s3", "b", 41), r("s3", "c", 41),
  ] };
const students = [
  { id: "s1", classId: "c1", name: "Ana Bell", color: "#000", notes: "Ana works best next to Zed Quill. Mo Rivers distracts her.",
    evidence: [
      { id: "e1", standard: "7.RP.1", score: 100, date: "2026-10-20", source: "Ratios quiz", assessmentId: "t1" },
      { id: "e2", standard: "7.RP.1", score: 70, date: "2026-10-10", source: "Partner work with Mo" },
      { id: "e3", standard: "7.EE.1", score: 0, date: "2026-10-20", source: "Ratios quiz", assessmentId: "t1" },
    ] },
  { id: "s2", classId: "c1", name: "Zed Quill", color: "#000", notes: "PRIVATE-ZED", evidence: [{ id: "e9", standard: "7.RP.1", score: 13, date: "2026-10-20", source: "Exit ticket" }] },
  { id: "s3", classId: "c1", name: "Mo Rivers", color: "#000", notes: "", evidence: [] },
  { id: "s4", classId: "c2", name: "Pat Lowe", color: "#000", notes: "", evidence: [] },
];
const w = { students, assessments: [t1], customStandards: [], sharedStandards: [], settings: { teacherName: "", school: "", reduceMotion: false } };
const classroom = { id: "c1", name: "Period 2 Math", grade: 7, gradingMode: "percentage" };
const build = (opts = {}) => R.studentReportHtml(w, classroom, students[0], { standards: ["7.RP.1", "7.EE.1"], now: NOW, ...opts }).html;
const OTHERS = ["Zed", "Quill", "Mo Rivers", "Rivers", "Pat", "Lowe", "PRIVATE-ZED", "ANSWER-s2", "ANSWER-s3", "s2 wrote", "13%", "41%"];

test("no other student's name, score or answer is in the printed HTML", () => {
  for (const html of [build(), build({ includeNotes: true })]) {
    for (const bad of OTHERS) assert.ok(!html.includes(bad), "must not print " + JSON.stringify(bad));
    assert.ok(!/\bMo\b/.test(html), "not even a first name");
    assert.ok(html.includes("Ana Bell"));
  }
  // A test named after a classmate prints with the name taken out.
  assert.match(build(), /another student&#39;s retake on ratios/);
});

test("the teacher's notes are off by default, and redacted when included", () => {
  assert.ok(!build().includes("works best"), "off unless asked for");
  const html = build({ includeNotes: true });
  assert.match(html, /Ana works best next to another student\. another student distracts her\./);
});

test("it holds their super grid with a class average per cluster, their error types, and the tracker for the chosen standards", () => {
  const html = build();
  assert.match(html, /<h2>Student super grid<\/h2>/);
  assert.match(html, /Class average/);
  // 7.RP: Ana 100 and 50 -> 75%; the class (Ana, s2, s3): 100 50 13 13 41 41 -> 258/6 = 43%.
  const rp = html.slice(html.indexOf(">7.RP<"), html.indexOf("</tr>", html.indexOf(">7.RP<")));
  assert.match(rp, /<td class="avg">75%<span>Approaching<\/span><\/td><td class="avg">43%<span>Beginning<\/span><\/td>/);
  assert.match(html, /<h2>Common error types<\/h2><ul><li><strong>[^<]+<\/strong> · 1 answer<\/li><li><strong>[^<]+<\/strong> · 1 answer<\/li><\/ul>/, "Ana's two, not s2's");
  assert.match(html, /<h2>Standard Tracker<\/h2><div class="std"><h3>7\.RP\.1/);
  assert.match(html, /<h3>7\.EE\.1/);
  assert.match(html, /Partner work with another student/, "an evidence source naming a classmate is redacted");
  assert.doesNotMatch(build({ standards: ["7.EE.1"] }), /<h3>7\.RP\.1/, "only the chosen standards");
  assert.match(html, /not an assessment of disability/);
});

test("each part can be printed on its own (the two reports on Student Reports)", () => {
  const gridOnly = build({ sections: { tracker: false } });
  assert.match(gridOnly, /Student super grid/);
  assert.doesNotMatch(gridOnly, /Standard Tracker/);
  const trackerOnly = build({ sections: { superGrid: false } });
  assert.match(trackerOnly, /Standard Tracker/);
  assert.doesNotMatch(trackerOnly, /Student super grid|Class average/);
});

test("redactOthers keeps the student's own name, even a word a classmate shares", () => {
  const roster = [{ id: "a", name: "Ana Bell" }, { id: "b", name: "Ana Cruz" }];
  assert.equal(R.redactOthers("Ana Bell and Ana Cruz", roster, "a"), "Ana Bell and another student");
  assert.equal(R.redactOthers("<b>", roster, "a"), "<b>", "redaction does not escape; escaping is separate");
});

test("it prints on one or two pages and is made in the browser: a Student report button, notes unticked, no request", () => {
  const html = build();
  assert.match(html, /@page\{size:auto;margin:12mm\}/);
  assert.match(html, /break-inside:avoid/);
  const page = readFileSync("components/teacher-insights.tsx", "utf8");
  assert.match(page, /onClick=\{\(\) => setReporting\(true\)\}>\s*<FileText size=\{16\} \/>\s*Student report/);
  const dialog = readFileSync("components/student-report.tsx", "utf8");
  assert.match(dialog, /const \[includeNotes, setIncludeNotes\] = useState\(false\)/);
  assert.match(dialog, /Print or save as PDF/);
  for (const f of ["lib/student-report.ts", "components/student-report.tsx"])
    assert.doesNotMatch(readFileSync(f, "utf8"), /fetch\(|\/api\/|callAi/, f + ": nothing sent anywhere");
});
