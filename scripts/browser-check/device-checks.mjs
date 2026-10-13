// PR 3 item 3: things shipped but never proven on a device. Real screens; the
// network is stood in for by a small in-memory server, which BOTH browser
// contexts share in check (b), so the phone's saves are what the desktop reads.
//
// (a) #122  Grading continues when the teacher switches screens mid-grading.
//     Proven when: leaving the assessment for another screen through the app's
//     own menu while a class is being graded, and coming back, finishes the SAME grading job (no second grading request)
//     and reaches the name-matching screen.
// (b) #106/#122  A scan started on a phone appears on an open desktop without
//     a refresh. Proven when: pages imported on a 390px phone appear on a
//     1366px desktop that already has the assessment open, within 20 s,
//     without reloading it.
// (c) #110  Older assessments open and show every page. Proven when: an
//     assessment in the shape saved before #108 (no targetStandards key, no
//     answer regions, two pages per student) opens without the error screen,
//     and an answer offers every page of that student's work.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const CHROMIUM = process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const only = (process.env.CHECKS || "a,b,c,d").split(",");

const pass = [];
const fail = [];
const check = (c, m) => (c ? pass : fail).push(m);
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

function baseWorkspace() {
  const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
  w.classes = w.classes.map((c) => ({ ...c, demo: false }));
  return w;
}

/** One stand-in server: workspace, uploads, session (with revisions, like
 * /api/scans/session), and background grading jobs that finish after a delay. */
function server(w, { gradeMs = 6000 } = {}) {
  const s = { w, revision: 7, session: { state: null, revision: 0 }, uploads: 0, gradePosts: 0, polls: {}, jobs: {} };
  const a = w.assessments.find((x) => x.id === "ela-demo");
  const roster = w.students.filter((st) => st.classId === a.classId);
  s.attach = async (ctx) => {
    await ctx.route("**/api/workspace", (r) => {
      if (r.request().method() === "GET")
        return r.fulfill(json({ workspace: s.w, revision: s.revision, aiReady: true, authProvider: "supabase", impersonating: null }));
      s.w = JSON.parse(r.request().postData()).workspace;
      return r.fulfill(json({ revision: ++s.revision }));
    });
    await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
    await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
    await ctx.route("**/api/uploads**", (r) =>
      r.request().method() === "POST" ? r.fulfill(json({ id: "upload-" + ++s.uploads, name: "p.jpg", size: 120000, mime: "image/jpeg", pages: 1 })) : r.fulfill({ status: 404, body: "" }));
    await ctx.route("**/api/scans/reserve", (r) => r.fulfill(json({ charged: 4, alreadyPaid: 0, remaining: 126 })));
    await ctx.route("**/api/scans/release", (r) => r.fulfill(json({ ok: true })));
    await ctx.route("**/api/scans/session**", (r) => {
      const m = r.request().method();
      if (m === "GET") return r.fulfill(json(s.session));
      if (m === "DELETE") {
        s.session = { state: null, revision: s.session.revision + 1 };
        return r.fulfill(json({ ok: true }));
      }
      const body = JSON.parse(r.request().postData());
      if (body.baseRevision !== s.session.revision) return r.fulfill(json(s.session, 409));
      s.session = { state: body.state, revision: s.session.revision + 1 };
      return r.fulfill(json({ revision: s.session.revision }));
    });
    await ctx.route("**/api/analyze/**", (r) => {
      const id = r.request().url().split("/api/analyze/")[1].split("?")[0];
      s.polls[id] = (s.polls[id] || 0) + 1;
      const job = s.jobs[id];
      if (!job) return r.fulfill(json({ error: "not found" }, 404));
      if (Date.now() < job.doneAt) return r.fulfill(json({ status: "analyzing" }));
      return r.fulfill(json({ status: "complete", result: job.result }));
    });
    await ctx.route("**/api/analyze", (r) => {
      const p = JSON.parse(r.request().postData() || "{}");
      if (p.mode === "name_strip") {
        const NAMES = { "upload-2": roster[0].name, "upload-6": roster[1].name };
        return r.fulfill(json({ result: { pages: p.uploadIds.map((id, i) => ({ page: i, name: NAMES[id] ?? "", confidence: NAMES[id] ? 96 : 0, box: null })) } }));
      }
      s.gradePosts++;
      const id = "scan-" + s.gradePosts;
      s.jobs[id] = {
        doneAt: Date.now() + gradeMs,
        result: { groups: p.pageGroups.map((_, g) => ({ group: g, responses: a.questions.map((q) => ({ questionId: q.id, answer: "a", verdict: "other", finalAnswer: "a" })) })) },
      };
      return r.fulfill(json({ scanId: id, status: "analyzing" }));
    });
  };
  return s;
}

async function jpegs(page) {
  const urls = await page.evaluate(() =>
    [0, 1, 2, 3].map((i) => {
      const c = document.createElement("canvas");
      c.width = 850;
      c.height = 1100;
      const g = c.getContext("2d");
      g.fillStyle = "#fff";
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = "#111";
      g.font = "40px sans-serif";
      g.fillText("Demo page " + (i + 1), 60, 120);
      return c.toDataURL("image/jpeg", 0.9);
    }),
  );
  return urls.map((u, i) => ({ name: `page-${i}.jpg`, mimeType: "image/jpeg", buffer: Buffer.from(u.split(",")[1], "base64") }));
}

async function importTwoStudents(page) {
  await page.locator('input[aria-label="Import a roll of photos of the whole class"]').setInputFiles(await jpegs(page));
  await page.getByRole("button", { name: /Import 2 students/i }).click({ timeout: 10000 });
}

const browser = await chromium.launch({ executablePath: CHROMIUM });

if (only.includes("a")) {
  const s = server(baseWorkspace(), { gradeMs: 7000 });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await s.attach(ctx);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/assessments?id=ela-demo&tab=responses`, { waitUntil: "networkidle" });
  await importTwoStudents(page);
  await page.getByRole("button", { name: /^Grade/i }).first().click({ timeout: 20000 });
  await page.waitForFunction(() => true);
  for (let i = 0; i < 60 && !s.gradePosts; i++) await page.waitForTimeout(250);
  check(s.gradePosts === 1, "(a) grading started (one grading request sent)");
  // Leave mid-grading for another screen INSIDE the app (the menu, as a
  // teacher would), then come back with the back button. A marker on window
  // proves neither step reloaded the page.
  await page.evaluate(() => { window.__sameDocument = true; });
  await page.locator(".mobile-menu").click();
  await page.locator('[data-mobile="true"] a[href="/classes"]').click();
  await page.waitForURL(/\/classes/, { timeout: 10000 });
  await page.waitForTimeout(500);
  check(!(await page.locator('[data-mobile="true"]').count()), "(a) the phone menu closed after its link was tapped");
  await page.waitForTimeout(1500);
  check(s.gradePosts === 1 && !(await page.evaluate(() => document.querySelector(".confirm-matches"))), "(a) on the Classes screen while grading runs, nothing re-sent");
  await page.goBack();
  await page.waitForURL(/ela-demo/, { timeout: 10000 });
  const done = await page.getByRole("button", { name: /Confirm & save 2 students/i }).waitFor({ timeout: 30000 }).then(() => true, () => false);
  check(done, "(a) back on the assessment, the same grading finishes and the name-matching screen appears");
  check(s.gradePosts === 1, `(a) no second grading request was sent (${s.gradePosts})`);
  check((s.polls["scan-1"] || 0) > 0, `(a) the in-flight job was picked up and polled (${s.polls["scan-1"] || 0} polls)`);
  check(await page.evaluate(() => window.__sameDocument === true), "(a) the switch and the return happened inside the app (no page reload)");
  await page.screenshot({ path: join(OUT, "device-a-resumed-390x844.png") });
  await ctx.close();
}

if (only.includes("b")) {
  const s = server(baseWorkspace());
  const desktop = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await s.attach(desktop);
  await s.attach(phone);
  const d = await desktop.newPage();
  await d.goto(`${BASE}/assessments?id=ela-demo&tab=responses`, { waitUntil: "networkidle" });
  const p = await phone.newPage();
  await p.goto(`${BASE}/assessments?id=ela-demo&tab=responses`, { waitUntil: "networkidle" });
  await importTwoStudents(p);
  const t0 = Date.now();
  for (let i = 0; i < 40 && !s.session.state; i++) await p.waitForTimeout(250);
  check(!!s.session.state, "(b) the phone saved its scan to the account");
  const seen = await d.getByText(/4 pages scanned|2 students · 4 pages/).first().waitFor({ timeout: 20000 }).then(() => true, () => false);
  check(seen, `(b) the open desktop shows the phone's 4 pages without a reload (${Math.round((Date.now() - t0) / 1000)} s)`);
  await d.screenshot({ path: join(OUT, "device-b-desktop-1366x768.png") });
  await desktop.close();
  await phone.close();
}

if (only.includes("c")) {
  const w = baseWorkspace();
  const a = w.assessments.find((x) => x.id === "math-demo");
  // As get_workspace_json returned an assessment saved before #108: the NULL
  // target_standards key stripped, no final answers, no answer regions.
  delete a.targetStandards;
  const students = [...new Set(a.responses.map((r) => r.studentId))];
  a.studentUploadIds = Object.fromEntries(students.map((id, i) => [id, ["old-" + i + "-p1", "old-" + i + "-p2"]]));
  a.responses = a.responses.map((r) => {
    const old = { ...r };
    delete old.finalAnswer;
    delete old.answerRegion;
    return { ...old, verified: false, correct: false, match: undefined, confidence: 100, answer: old.answer || "12" };
  });
  const s = server(w);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await s.attach(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/assessments?id=math-demo&tab=responses`, { waitUntil: "networkidle" });
  check(!(await page.getByText(/Something went wrong|couldn.t load this page/i).count()) && errors.length === 0, `(c) the older assessment opens without the error screen${errors.length ? " — " + errors[0].slice(0, 120) : ""}`);
  await page.locator("#grade-by-question").getByRole("button", { name: /^Review|^Look again/ }).first().click();
  const pageTwo = page.getByRole("button", { name: "Show page 2 of this student's work" }).first();
  const offered = await pageTwo.waitFor({ timeout: 10000 }).then(() => true, () => false);
  check(offered, "(c) an answer offers page 2 of the student's work, not just page 1");
  if (offered) {
    await pageTwo.click();
    const src = await page.locator(".work-sample-thumb img").first().getAttribute("src");
    check(/old-\d+-p2$/.test(src || ""), `(c) and shows it (${src})`);
  }
  await page.screenshot({ path: join(OUT, "device-c-older-assessment-390x844.png") });
  await ctx.close();
}

if (only.includes("d")) {
  // (d) #126 review: the phone menu stayed open over the screen after a menu
  //     link when the page did not happen to remount -- reproduced with
  //     "Assessments" tapped from inside an assessment, at 390 and 412.
  //     Proven when: after tapping a menu link, the menu is closed, both for
  //     another screen and for the screen already open.
  for (const [W, H] of [[390, 844], [412, 915]]) {
    const s = server(baseWorkspace());
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, isMobile: true, hasTouch: true });
    await s.attach(ctx);
    const page = await ctx.newPage();
    for (const href of ["/assessments", "/classes"]) {
      await page.goto(`${BASE}/assessments?id=math-demo&tab=responses`, { waitUntil: "networkidle" });
      await page.locator(".mobile-menu").tap();
      const sheet = page.locator('[data-mobile="true"]');
      await sheet.waitFor({ timeout: 5000 });
      await page.locator(`[data-mobile="true"] a[href="${href}"]`).tap();
      await page.waitForTimeout(1200);
      const open = (await sheet.count()) > 0 && (await sheet.isVisible());
      check(!open, `(d) ${W}x${H}: menu closed after tapping "${href}" from inside an assessment`);
      if (open) await page.screenshot({ path: join(OUT, `device-d-menu-open-${W}.png`) });
    }
    await ctx.close();
  }
}

await browser.close();
console.log("=== DEVICE CHECKS ===");
for (const p of pass) console.log("  OK   " + p);
for (const f of fail) console.log("  FAIL " + f);
console.log(`\n${pass.length}/${pass.length + fail.length} assertions passed`);
process.exit(fail.length ? 1 : 0);
