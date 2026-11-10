// Worst-case page count for the printable student report (privacy review of
// #209): the biggest report the caps allow -- 5 cluster rows in the grid, 8
// Standard Tracker standards x 6 records each, and a full 600-character note --
// must still print on at most 2 pages on Letter and A4. Renders the report HTML
// (built by lib/student-report.ts) with a headless Chromium print. Made-up data.
import { buildSync } from "esbuild";
import { chromium } from "playwright";

const CHROMIUM = process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
function bundle(path) { const r = buildSync({ entryPoints: [path], bundle: true, platform: "node", format: "cjs", write: false }); const m = { exports: {} }; new Function("module", "exports", r.outputFiles[0].text)(m, m.exports); return m.exports; }
const R = bundle("lib/student-report.ts");
const pass = [], fail = [];
const check = (c, m) => (c ? pass : fail).push(m);

const NOW = new Date(2026, 9, 27, 12);
const q = (id, standard, dok) => ({ id, number: 1, text: "", passage: "", answer: "4", standard, secondary: "", skill: "", dok, alignment: 90, confidence: 90, level: "", reasoning: "", verified: true, excluded: false });
const r = (sid, qid, m) => ({ id: sid + qid, studentId: sid, questionId: qid, answer: "x", correct: m === 100, match: m, misconception: "", confidence: 90, verified: true });
const clusters = ["7.RP", "7.NS", "7.EE", "7.G", "7.SP"];
const questions = [], responses = [];
for (const c of clusters) for (const dok of [1, 2, 3, 4]) {
  const qid = c + ".q" + dok; questions.push(q(qid, c + ".1", dok));
  responses.push(r("s1", qid, 55)); for (let o = 0; o < 6; o++) responses.push(r("o" + o, qid, 40));
}
const t1 = { id: "t1", classId: "c1", title: "T", subject: "Math", grade: 7, framework: "Common Core", createdAt: "2026-09-01T12:00:00Z", status: "Ready", source: "manual", targetStandards: [], answerKeyVerified: true, uploadIds: [], dateGiven: "2026-10-20", questions, responses };
const evidence = [], trackerCodes = [];
for (let i = 0; i < 8; i++) { const code = "7.RP." + (i + 1); trackerCodes.push(code); for (let k = 0; k < 6; k++) evidence.push({ id: code + "-" + k, standard: code, score: 50 + k, date: "2026-10-0" + (k + 1), source: "S" }); }
const students = [{ id: "s1", classId: "c1", name: "Amelia Rutherford-Beaumont", color: "#000", notes: "", evidence }, ...Array.from({ length: 6 }, (_, o) => ({ id: "o" + o, classId: "c1", name: "Other " + o, color: "#000", notes: "", evidence: [] }))];
const w = { students, assessments: [t1], customStandards: [], sharedStandards: [], settings: { teacherName: "", school: "", reduceMotion: false } };
const { html } = R.studentReportHtml(w, { id: "c1", name: "P2", grade: 7, gradingMode: "percentage" }, students[0], { standards: trackerCodes, note: "N".repeat(600), now: NOW });
check((html.match(/<div class="std">/g) || []).length === 8, "8 tracker standards in the worst case");
check((html.match(/<tr><th scope="row"/g) || []).length === 5, "5 cluster rows in the worst case");

const browser = await chromium.launch({ executablePath: CHROMIUM });
try {
  const page = await browser.newPage();
  await page.setContent("<!doctype html>" + html);
  for (const format of ["Letter", "A4"]) {
    const pdf = await page.pdf({ format, printBackground: true });
    const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) || []).length;
    check(pages >= 1 && pages <= 2, `worst case is ${pages} page(s) on ${format}`);
  }
} finally { await browser.close(); }
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
