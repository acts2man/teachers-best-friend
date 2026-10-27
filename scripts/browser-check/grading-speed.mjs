// Faster grading (26 Oct 2026), driven through the real class-scan screen: a
// roll of 48 photos imported as 24 students (declared piles, two pages each),
// then Grade. The AI is stood in for with fixed demo answers and a fixed delay
// per request (name read 1.5 s, grading 4 s), and every request's start and
// end is recorded.
//
// Proven when, at 390x844 and 1366x768: grading starts before the last name
// read has finished; three grading requests are in flight at once and never
// more; every student is graded exactly once and reaches the matching screen;
// and the console logs the run's total time. (That each answer lands on the
// student it was graded for is proven in tests/grading-concurrency.test.mjs.)
// Only the network is stood in for (demo data, no AI spend).
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const CHROMIUM = process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pass = [];
const fail = [];
const check = (c, m) => (c ? pass : fail).push(m);
const STUDENTS = 24;
const NAME_MS = 1500;
const GRADE_MS = 4000;

const browser = await chromium.launch({ executablePath: CHROMIUM });
async function makeJpegs(n) {
  const p = await browser.newPage();
  const urls = await p.evaluate((n) =>
    Array.from({ length: n }, (_, i) => {
      const c = document.createElement("canvas");
      c.width = 850;
      c.height = 1100;
      const g = c.getContext("2d");
      g.fillStyle = "#fff";
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = "#111";
      g.font = "40px sans-serif";
      g.fillText("Demo worksheet page " + (i + 1), 60, 120);
      return c.toDataURL("image/jpeg", 0.85);
    }), n);
  await p.close();
  return urls.map((u, i) => ({ name: `page-${i}.jpg`, mimeType: "image/jpeg", buffer: Buffer.from(u.split(",")[1], "base64") }));
}
const files = await makeJpegs(STUDENTS * 2);

for (const [W, H] of [[390, 844], [1366, 768]]) {
  const tag = `${W}x${H}`;
  const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
  w.classes = w.classes.map((c) => ({ ...c, demo: false }));
  const a = w.assessments.find((x) => x.id === "ela-demo");
  const questionIds = a.questions.filter((q) => !q.excluded).map((q) => q.id);
  const log = [];
  let uploads = 0;
  // Upload order is body, strip for each page: a body id's number says which
  // page (and so which student) it is.
  const bodyPage = new Map();
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route("**/api/workspace", (r) =>
    r.request().method() === "GET"
      ? r.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }))
      : r.fulfill(json({ revision: 8 })),
  );
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 500, used: 0, remaining: 500, can_scan: true })));
  await ctx.route("**/api/uploads**", (r) => {
    if (r.request().method() !== "POST") return r.fulfill(json({}, 404));
    uploads++;
    if (uploads % 2 === 1) bodyPage.set("upload-" + uploads, (uploads - 1) / 2);
    return r.fulfill(json({ id: "upload-" + uploads, name: "page.jpg", size: 90000, mime: "image/jpeg", pages: 1 }));
  });
  await ctx.route("**/api/scans/reserve", (r) => r.fulfill(json({ charged: STUDENTS * 2, alreadyPaid: 0, remaining: 400 })));
  await ctx.route("**/api/scans/release", (r) => r.fulfill(json({ ok: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  await ctx.route("**/api/scans/session**", (r) => r.fulfill(json(r.request().method() === "GET" ? { state: null, revision: 0 } : { revision: 1, ok: true })));
  const t0 = { at: 0 };
  await ctx.route("**/api/analyze", async (r) => {
    const p = JSON.parse(r.request().postData() || "{}");
    const entry = { mode: p.mode, start: Date.now(), end: 0, students: [] };
    log.push(entry);
    if (p.mode === "name_strip") {
      await sleep(NAME_MS);
      entry.end = Date.now();
      return r.fulfill(json({ model: "mock", result: { pages: p.uploadIds.map((_, i) => ({ page: i, name: "", confidence: 0, box: null })) } }));
    }
    if (p.mode === "class_scan") {
      // The student each group is: its first page's number, halved.
      entry.students = p.pageGroups.map((g) => Math.floor(bodyPage.get(p.uploadIds[g[0]]) / 2));
      await sleep(GRADE_MS);
      entry.end = Date.now();
      return r.fulfill(json({ model: "mock", result: { groups: p.pageGroups.map((g, k) => ({
        group: k,
        // The answer names the student it was graded for, so a mix-up shows.
        responses: questionIds.map((questionId) => ({ questionId, answer: "answer for student " + entry.students[k], verdict: "other", finalAnswer: "s" + entry.students[k] })),
      })) } }));
    }
    return r.fulfill(json({ error: "unexpected mode " + p.mode }, 400));
  });
  const page = await ctx.newPage();
  const errors = [];
  const consoleLines = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  page.on("console", (m) => consoleLines.push(m.text()));
  try {
    await page.goto(`${BASE}/assessments?id=ela-demo&tab=responses`, { waitUntil: "networkidle", timeout: 30000 });
    await page.locator('input[aria-label="Import a roll of photos of the whole class"]').setInputFiles(files);
    await page.getByRole("button", { name: new RegExp(`Import ${STUDENTS} students`, "i") }).click({ timeout: 20000 });
    await page.getByRole("button", { name: /^Grade/i }).first().click({ timeout: 120000 });
    t0.at = Date.now();
    await page.getByRole("button", { name: new RegExp(`Confirm & save ${STUDENTS} students`, "i") }).waitFor({ timeout: 180000 });
  } catch (e) {
    fail.push(`${tag}: could not drive the flow: ${String(e).split("\n")[0]}`);
    await page.screenshot({ path: join(OUT, `grading-speed-FAILED-${tag}.png`) });
  }
  const names = log.filter((x) => x.mode === "name_strip");
  const grades = log.filter((x) => x.mode === "class_scan");
  const lastName = Math.max(...names.map((x) => x.end));
  const firstGrade = Math.min(...grades.map((x) => x.start));
  let most = 0;
  for (const g of grades) most = Math.max(most, grades.filter((o) => o.start <= g.start && o.end > g.start).length);
  check(names.length === STUDENTS, `${tag}: one name read per student (${names.length})`);
  check(grades.length >= 4, `${tag}: several grading requests (${grades.length})`);
  check(firstGrade < lastName, `${tag}: grading started ${((lastName - firstGrade) / 1000).toFixed(1)} s before the last name read finished`);
  check(most === 3, `${tag}: three grading requests in flight at once, never more (most: ${most})`);
  const graded = grades.flatMap((g) => g.students).sort((x, y) => x - y);
  check(JSON.stringify(graded) === JSON.stringify(Array.from({ length: STUDENTS }, (_, i) => i)), `${tag}: every student graded exactly once`);
  const rowAnswers = await page.evaluate(() => [...document.querySelectorAll(".name-match-row")].length);
  check(rowAnswers === STUDENTS, `${tag}: ${rowAnswers} students on the matching screen`);
  const timing = consoleLines.find((l) => l.startsWith("class scan: "));
  check(!!timing && new RegExp(`^class scan: ${STUDENTS} students, ${STUDENTS * 2} pages graded in \\d+ s`).test(timing), `${tag}: the total time is logged (${timing ?? "nothing logged"})`);
  check(errors.length === 0, `${tag}: no page errors ${errors.join(" | ")}`);
  console.log(`${tag}: Grade to matching screen ${((Date.now() - t0.at) / 1000).toFixed(1)} s with ${grades.length} grading requests of ${GRADE_MS / 1000} s and ${names.length} name reads of ${NAME_MS / 1000} s`);
  await page.screenshot({ path: join(OUT, `grading-speed-${tag}.png`) });
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
