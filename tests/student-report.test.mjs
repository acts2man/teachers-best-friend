// The printable student report (docs/design/super-grids.md section 4; Ricky
// 22/27 Oct, privacy review of #209). Proven when the report, built in the
// browser with no AI call, holds ONLY this student's own figures plus a class
// average per cluster that is shown only where at least 5 OTHER students
// answered -- and carries NO teacher-typed free text that could name a
// classmate (test titles, evidence sources, stored notes, custom "Other"
// text), even when those fields are full of classmates' names (accented,
// hyphenated, curly-apostrophe, initialled, a former student, a common word).
// The one free-text field is a note the teacher types for this report. Made-up
// names and data only.
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
const [E1] = bundle("lib/error-types.ts").errorTypesFor("Math");

const NOW = new Date(2026, 9, 27, 12);
const q = (id, standard, dok) => ({ id, number: 1, text: "", passage: "", answer: "", standard, secondary: "", skill: "", dok, alignment: 90, confidence: 90, level: "", reasoning: "", verified: true, excluded: false });
const r = (studentId, questionId, match, extra = {}) => ({ id: studentId + questionId, studentId, questionId, answer: studentId + " wrote ANSWER-" + studentId, correct: match === 100, match, misconception: "", confidence: 90, verified: true, ...extra });
const base = { classId: "c1", subject: "Math", grade: 7, framework: "California", createdAt: "2026-09-01T12:00:00Z", status: "Ready", source: "manual", targetStandards: [], answerKeyVerified: true, uploadIds: [] };

// Classmates with names that trip simple redaction, planted everywhere a
// classmate's name could leak: a test title, evidence sources, stored notes.
const TRICKY = ["Zoé Bär", "Al-Rashid", "O’Brien", "O'Brien", "J. Kim", "Will May", "Former Student"];
const t1 = {
  ...base, id: "t1", title: "Retake for " + TRICKY.join(", "), dateGiven: "2026-10-20",
  questions: [q("a", "7.RP.1", 1), q("b", "7.RP.2", 2), q("c", "7.EE.1", 3)],
  responses: [
    r("s1", "a", 100), r("s1", "b", 50, { errorType: E1 }), r("s1", "c", 0, { errorType: "Other: SECRET-OTHER-TEXT" }),
    // Six other students answer the 7.RP cluster (q a); none answer 7.EE.
    ...["s2", "s3", "s4", "s5", "s6", "s7"].map((id) => r(id, "a", 20)),
  ],
};
const students = [
  { id: "s1", classId: "c1", name: "Ana Bell", color: "#000",
    notes: "Ana sits by " + TRICKY.join(" and ") + ". PRIVATE-NOTE.",
    evidence: [
      { id: "e1", standard: "7.RP.1", score: 100, date: "2026-10-20", source: "Quiz with " + TRICKY[0], assessmentId: "t1" },
      { id: "e2", standard: "7.RP.1", score: 70, date: "2026-10-10", source: "Partner work with " + TRICKY[2] },
      { id: "e3", standard: "7.EE.1", score: 0, date: "2026-10-20", source: TRICKY[5] + " helped", assessmentId: "t1" },
    ] },
  ...["s2", "s3", "s4", "s5", "s6", "s7"].map((id, i) => ({ id, classId: "c1", name: TRICKY[i] ?? "Pat Lowe", color: "#000", notes: "", evidence: [] })),
];
const w = { students, assessments: [t1], customStandards: [], sharedStandards: [], settings: { teacherName: "", school: "", reduceMotion: false } };
const classroom = { id: "c1", name: "Period 2 " + TRICKY[0], grade: 7, gradingMode: "percentage" };
const build = (opts = {}) => R.studentReportHtml(w, classroom, students[0], { standards: ["7.RP.1", "7.EE.1"], now: NOW, ...opts }).html;

test("no classmate's name, nor any stored free text, is in the printed HTML", () => {
  const html = build();
  for (const name of TRICKY) assert.ok(!html.includes(name), "must not print classmate name " + JSON.stringify(name));
  // The distinctive parts, too.
  for (const token of ["Bär", "Al-Rashid", "Brien", "Kim", "SECRET-OTHER-TEXT", "PRIVATE-NOTE", "ANSWER-s2", "Retake for", "Partner work", "Quiz with", "Period 2"])
    assert.ok(!html.includes(token), "must not print " + JSON.stringify(token));
  assert.ok(html.includes("Ana Bell"), "the student's own name is shown");
  assert.ok(!/<th>From<\/th>/.test(html), "the tracker drops the teacher-typed source column");
});

test("a typed note is the only free text, and appears verbatim (escaped)", () => {
  assert.ok(!build().includes("Notes for this report"), "no note section when the box is empty");
  const html = build({ note: "Meet Tue; focus on ratios <3" });
  assert.match(html, /<h2>Notes for this report<\/h2><p>Meet Tue; focus on ratios &lt;3<\/p>/);
});

test("a custom \"Other: ...\" error shows as just \"Other\" -- no typed detail", () => {
  const html = build();
  assert.match(html, /<strong>Other<\/strong>/);
  assert.ok(!html.includes("SECRET-OTHER-TEXT"));
  assert.equal(R.fixedErrorName("Other: anything a teacher typed"), "Other");
  assert.equal(R.fixedErrorName("Setup/Method Error"), "Setup/Method Error");
});

test("a class average shows only where at least 5 OTHER students answered the cluster", () => {
  const html = build();
  // 7.RP: six others answered q a -> the class average is a number.
  const rp = html.slice(html.indexOf(">7.RP<"), html.indexOf("</tr>", html.indexOf(">7.RP<")));
  assert.match(rp, /<td class="avg">\d+%<span>[^<]+<\/span><\/td><td class="avg">\d+%<span>[^<]+<\/span><\/td>/, "this student's own + the class average, both numbers");
  // 7.EE: no other student answered -> the class-average cell is blank.
  const ee = html.slice(html.indexOf(">7.EE<"), html.indexOf("</tr>", html.indexOf(">7.EE<")));
  const cells = ee.match(/<td class="avg">[^<]*/g) || [];
  assert.equal(cells.length, 2);
  assert.match(cells[0], /\d+%/, "this student's own 7.EE average still shows");
  assert.equal(cells[1].replace('<td class="avg">', ""), "—", "no class average with too few other answerers");
});

test("a class of two never shows a class average (one classmate could be read off it)", () => {
  const small = {
    students: [
      { id: "a", classId: "k", name: "Ana Bell", color: "#000", notes: "", evidence: [] },
      { id: "b", classId: "k", name: "Bo Cole", color: "#000", notes: "", evidence: [] },
    ],
    assessments: [{ ...base, id: "tk", classId: "k", title: "Bo Cole quiz", dateGiven: "2026-10-20",
      questions: [q("a", "7.RP.1", 1)], responses: [r("a", "a", 90), r("b", "a", 10)] }],
    customStandards: [], sharedStandards: [], settings: { teacherName: "", school: "", reduceMotion: false },
  };
  const html = R.studentReportHtml(small, { id: "k", name: "K", grade: 7, gradingMode: "percentage" }, small.students[0], { standards: [], now: NOW }).html;
  const rp = html.slice(html.indexOf(">7.RP<"), html.indexOf("</tr>", html.indexOf(">7.RP<")));
  const cells = rp.match(/<td class="avg">[^<]*/g) || [];
  assert.equal(cells[1].replace('<td class="avg">', ""), "—", "class average hidden");
  assert.ok(!html.includes("Bo Cole"), "the classmate's name (and the test named after them) never appears");
});

test("the academic-standard title (catalog text) is kept, and only the chosen standards appear", () => {
  const html = build();
  assert.match(html, /<h2>Student super grid<\/h2>/);
  assert.match(html, /<h2>Standard Tracker<\/h2><div class="std"><h3>7\.RP\.1/);
  assert.match(html, /<h3>7\.EE\.1/);
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

test("it prints on one or two pages, is made in the browser, and the dialog offers a report-only note box", () => {
  const html = build();
  assert.match(html, /@page\{size:auto;margin:12mm\}/);
  assert.match(html, /break-inside:avoid/);
  const page = readFileSync("components/teacher-insights.tsx", "utf8");
  assert.match(page, /onClick=\{\(\) => setReporting\(true\)\}>\s*<FileText size=\{16\} \/>\s*Student report/);
  const dialog = readFileSync("components/student-report.tsx", "utf8");
  assert.match(dialog, /Notes for this report \(optional\)/);
  assert.doesNotMatch(dialog, /includeNotes/, "the stored-notes toggle is gone");
  assert.match(dialog, /Print or save as PDF/);
  for (const f of ["lib/student-report.ts", "components/student-report.tsx"])
    assert.doesNotMatch(readFileSync(f, "utf8"), /fetch\(|\/api\/|callAi/, f + ": nothing sent anywhere");
  // No stored free text is ever read into the report.
  assert.doesNotMatch(readFileSync("lib/student-report.ts", "utf8"), /\.notes\b|\.source\b|redactOthers/, "no stored notes, sources, or redaction (catalog titles are allowed)");
});

// ---- Custom/shared standards print as code only (privacy review of #209) ----
const CUSTOM = "Zoé Bär"; // a classmate's name, planted in a custom standard's title AND domain
const mkStd = (over) => ({ subject: "Math", grade: 7, framework: "California", cluster: "", summary: "", skills: [], prerequisites: [], next: [], vocabulary: [], misconception: "", ...over });
const customUnparsed = mkStd({ code: "LOCAL.1", title: "Ratios, by " + CUSTOM, domain: CUSTOM + "'s custom unit" });
const customParsed = mkStd({ code: "7.ZZ.1", title: "Made by " + CUSTOM, domain: CUSTOM + " domain" });
const tc = { ...base, id: "tc", title: "X", dateGiven: "2026-10-20",
  questions: [q("ca", "LOCAL.1", 1), q("cb", "7.ZZ.1", 2)],
  responses: [r("s1", "ca", 80), r("s1", "cb", 80)] };
const wc = {
  students: [{ id: "s1", classId: "c1", name: "Ana Bell", color: "#000", notes: "",
    evidence: [{ id: "ev1", standard: "LOCAL.1", score: 80, date: "2026-10-20" }, { id: "ev2", standard: "7.ZZ.1", score: 80, date: "2026-10-20" }] }],
  assessments: [tc], customStandards: [customUnparsed, customParsed], sharedStandards: [],
  settings: { teacherName: "", school: "", reduceMotion: false },
};
const buildC = (opts = {}) => R.studentReportHtml(wc, classroom, wc.students[0], { standards: ["LOCAL.1", "7.ZZ.1"], now: NOW, ...opts }).html;

test("a custom standard prints as its code only -- never its teacher-typed title or domain", () => {
  const html = buildC();
  assert.ok(!html.includes(CUSTOM), "the custom standard's title/domain name never prints");
  for (const bad of ["Bär", "Zoé", "custom unit", "Ratios, by", "Made by", "7.ZZ domain", CUSTOM + " domain"])
    assert.ok(!html.includes(bad), "must not print " + JSON.stringify(bad));
  // The tracker headings are the codes alone (no " — title").
  assert.match(html, /<h3>LOCAL\.1<\/h3>/, "custom code, no title");
  assert.match(html, /<h3>7\.ZZ\.1<\/h3>/, "custom code with a parseable prefix, still no title");
  // The grid clusters: a parseable prefix shows the code; an unparseable one is "Other standards".
  assert.match(html, /scope="row">7\.ZZ</, "the code prefix is derived from the code, not the custom domain");
  assert.match(html, /scope="row">Other standards</, "an unparseable custom code never prints its custom domain");
});

test("a built-in standard still prints its catalog title and cluster domain", () => {
  const html = build();
  // 7.RP.1 is a bundled California standard: its title and the Ratios domain print.
  assert.match(html, /<h3>7\.RP\.1 — [^<]+<\/h3>/, "a built-in tracker title prints");
  assert.match(html, /scope="row">7\.RP<small>[^<]+<\/small>/, "a built-in cluster shows its catalog domain subtitle");
});

test("the teacher's note is capped so the worst case stays on two pages", () => {
  const long = "x".repeat(700);
  const html = build({ note: long });
  const printed = html.slice(html.indexOf("Notes for this report"));
  const body = printed.slice(printed.indexOf("<p>") + 3, printed.indexOf("</p>"));
  assert.equal(body.length, R.MAX_NOTE_CHARS ?? 600, "the note is sliced to the cap");
  assert.ok(body.length <= 600);
  const dialog = readFileSync("components/student-report.tsx", "utf8");
  assert.match(dialog, /maxLength=\{MAX_NOTE_CHARS\}/, "the box enforces the cap");
  assert.match(dialog, /student-report-note-count/, "with a counter");
});
