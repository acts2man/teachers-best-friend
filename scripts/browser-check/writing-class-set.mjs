// Writing "Add student work" is the class-set camera, rebuilt on the SAME
// ClassScanPanel as a math/reading test (review of PR #218). At 390x844
// (Android) and 1366x768, with Chromium's fake camera reading a .y4m page and
// /api/* mocked (no AI spend, no real camera), this proves the writing-specific
// must-holds end to end:
//   1. two piles read as the SAME student block scoring until the teacher fixes
//      it, and each student ends with only their own pages and scores;
//   4. a reload on the matching screen restores it (scan session);
//   5. after scoring, a reload brings the rubric scores and each student's pages
//      back from the saved workspace;
//   6. the stack is reserved up front; a 402 shows the out-of-credits message.
// (Move/Swap/Undo, photos-never-lost and mid-grade resume are the SAME shared
// ClassScanPanel code the math class-set browser checks already exercise.)
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const CHROMIUM = process.env.CHROMIUM || "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pass = [];
const fail = [];
const check = (c, m) => (c ? pass : fail).push(m);

/** A sharp .y4m of a white page with dark lines on a dark table. */
function pageVideo() {
  const W = 720, H = 1280, FRAMES = 8, pw = 620, ph = 1080;
  const y = Buffer.alloc(W * H, 50);
  const x0 = Math.round((W - pw) / 2), y0 = Math.round((H - ph) / 2);
  for (let r = y0; r < y0 + ph; r++) y.fill(245, r * W + x0, r * W + x0 + pw);
  const step = Math.max(10, Math.round(ph / 28));
  for (let k = 3; k < 26; k++) {
    const r0 = y0 + k * step;
    if (r0 > y0 + ph - step) break;
    const len = Math.round(pw * (0.5 + (0.4 * ((k * 37) % 10)) / 10));
    for (let t = 0; t < Math.max(2, Math.round(pw / 160)); t++) y.fill(20, (r0 + t) * W + x0 + Math.round(pw * 0.08), (r0 + t) * W + x0 + len);
  }
  const uv = Buffer.alloc((W / 2) * (H / 2) * 2, 128);
  const parts = [Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`)];
  for (let f = 0; f < FRAMES; f++) parts.push(Buffer.from("FRAME\n"), y, uv);
  const file = join(tmpdir(), "tbf-writing-page.y4m");
  writeFileSync(file, Buffer.concat(parts));
  return file;
}
const VIDEO = pageVideo();

const TRAITS = [
  { id: "t1", name: "Answer", max: 4, descriptor: "States a clear claim", standard: "W.4.1" },
  { id: "t2", name: "Cite Evidence", max: 4, descriptor: "Uses text evidence", standard: "RI.4.1" },
];

async function shoot(page, n) {
  const shutter = page.locator("button.scan-camera-shutter");
  const keep = page.getByRole("button", { name: "Keep", exact: true });
  const before = await page.locator(".scan-camera-thumb").count();
  for (let i = 0; i < n; i++) {
    await shutter.click();
    if (await keep.waitFor({ timeout: 1500 }).then(() => true, () => false)) await keep.click();
    await page.waitForFunction((want) => document.querySelectorAll(".scan-camera-thumb").length >= want, before + i + 1, { timeout: 8000 }).catch(() => {});
    await sleep(200);
  }
}

/** A context whose mocked workspace + scan session are STATEFUL: a save is read
 *  back on the next load (round trip), and the session survives a reload. */
function makeContext(browser, { W, H, roster, sameName, reserve402 }) {
  const [A, B] = roster;
  const base = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
  base.classes = base.classes.map((c) => ({ ...c, demo: false, gradingMode: "percentage" }));
  base.assessments = [
    {
      id: "writing-demo", classId: base.activeClassId, title: "Opinion essay", subject: "ELA", elaArea: "writing",
      grade: base.classes[0].grade, framework: base.classes[0].framework, createdAt: "2026-11-17T00:00:00Z", status: "Ready",
      uploadIds: [], source: "manual", targetStandards: [], questions: [], genre: "informational", rubric: TRAITS,
      responses: [],
    },
    ...base.assessments,
  ];
  const state = { served: base, saved: null, session: null, revision: 7, uploadN: 0, reserveCalls: 0, writingReqs: [] };
  return browser.newContext({ viewport: { width: W, height: H }, isMobile: W < 800, hasTouch: true, permissions: ["camera"] }).then(async (ctx) => {
    await ctx.route("**/api/workspace", (r) => {
      if (r.request().method() === "GET") return r.fulfill(json({ workspace: state.served, revision: state.revision, aiReady: true, authProvider: "supabase", impersonating: null }));
      const body = JSON.parse(r.request().postData() || "{}");
      state.saved = body.workspace || body;
      state.served = state.saved; // read back on the next load -> round trip
      state.revision += 1;
      return r.fulfill(json({ revision: state.revision }));
    });
    await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 500, used: 0, remaining: 500, can_scan: true })));
    await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
    await ctx.route("**/api/scans/session**", (r) => {
      if (r.request().method() === "GET") return r.fulfill(json(state.session ? { state: state.session, revision: 1 } : { state: null, revision: 0 }));
      try { state.session = JSON.parse(r.request().postData() || "{}").state ?? state.session; } catch { /* keep */ }
      return r.fulfill(json({ revision: 1, ok: true }));
    });
    await ctx.route("**/api/scans/reserve", (r) => {
      state.reserveCalls++;
      if (reserve402) return r.fulfill(json({ error: "This class set is 6 pages and you have 2 scans left." }, 402));
      return r.fulfill(json({ charged: 0, alreadyPaid: 6, remaining: 500 }));
    });
    await ctx.route("**/api/scans/release", (r) => r.fulfill(json({ ok: true })));
    await ctx.route("**/api/uploads**", (r) => {
      if (r.request().method() !== "POST") return r.fulfill(json({}, 404));
      return r.fulfill(json({ id: "upload-" + ++state.uploadN, name: "page.jpg", size: 120000, mime: "image/jpeg", pages: 1 }));
    });
    await ctx.route("**/api/analyze", (r) => {
      const p = JSON.parse(r.request().postData() || "{}");
      if (p.mode === "name_strip") {
        const first = p.uploadIds[0];
        // The first pile's body ids are 1,3,5 (strips 2,4,6); the second 7,9,11.
        const which = first === "upload-2" ? A.name : first === "upload-8" ? (sameName ? A.name : B.name) : "";
        return r.fulfill(json({ result: { pages: [{ page: 0, name: which, confidence: 96, box: { x: 0.1, y: 0.05, width: 0.5, height: 0.08 } }] } }));
      }
      if (p.mode === "writing") {
        state.writingReqs.push({ studentId: p.studentId, pages: p.uploadIds.length });
        const responses = TRAITS.map((t, i) => ({
          id: p.studentId + t.id, studentId: p.studentId, questionId: t.id, answer: "", correct: i === 0,
          match: i === 0 ? 100 : 50, rubricScore: i === 0 ? 4 : 2, rubricReason: "demo", misconception: "", confidence: 100, verified: false,
        }));
        return r.fulfill(json({ result: { responses } }));
      }
      return r.fulfill(json({ result: {} }));
    });
    return { ctx, state };
  });
}

async function openCamera(page) {
  await page.goto(`${BASE}/assessments?id=writing-demo&tab=responses`, { waitUntil: "networkidle", timeout: 30000 });
  const panel = page.locator(".panel", { hasText: "Photograph the whole class" });
  await panel.getByRole("button", { name: /Scan student work/ }).click();
  await page.waitForFunction(() => { const b = document.querySelector("button.scan-camera-shutter"); return b && !b.disabled; }, null, { timeout: 30000 });
  const auto = page.locator("button[aria-pressed]", { hasText: "Auto" }).first();
  if ((await auto.count()) && (await auto.getAttribute("aria-pressed")) === "true") await auto.click();
}

/** Capture two 3-page students and reach the matching screen. After "Finished"
 *  the camera closes to the capture screen; the Grade button runs the name pass
 *  and matching (and reserves the stack up front), then the match screen shows. */
async function captureTwoStudents(page) {
  await shoot(page, 3);
  await page.getByRole("button", { name: /Next student/ }).click();
  await shoot(page, 3);
  await page.getByRole("button", { name: /^Finished$/ }).click();
  const grade = page.getByRole("button", { name: /^Grade\b/ });
  await grade.waitFor({ state: "visible", timeout: 30000 });
  await grade.click();
  await page.locator(".class-scan-groups .name-match-row").first().waitFor({ timeout: 30000 });
}

const browser = await chromium.launch({
  executablePath: CHROMIUM,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--use-file-for-fake-video-capture=" + VIDEO],
});
const fixture = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
const roster = fixture.students.filter((s) => s.classId === fixture.activeClassId).slice(0, 2);
const [A, B] = roster;

for (const [W, H] of [[390, 844], [1366, 768]]) {
  const tag = `${W}x${H}`;
  const { ctx, state } = await makeContext(browser, { W, H, roster });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  try {
    await openCamera(page);
    check(true, `${tag}: Add student work opens the class-set camera`);
    await captureTwoStudents(page);
    const groups = page.locator(".class-scan-groups .name-match-row");
    check((await groups.count()) === 2, `${tag}: two students on the matching screen (${await groups.count()})`);

    // Must-hold 4: a reload on the matching screen restores it (scan session).
    // Let the session sync (debounced POST) land before reloading.
    await page.waitForFunction(() => true);
    await sleep(1800);
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(".class-scan-groups .name-match-row").first().waitFor({ timeout: 30000 });
    check((await page.locator(".class-scan-groups .name-match-row").count()) === 2, `${tag}: a reload on the matching screen restores both students`);

    // Must-hold 1 (end state): score, then each student has only their own pages.
    await page.getByRole("button", { name: /^Score 2 students$/ }).click();
    await page.waitForFunction(() => !document.querySelector(".class-scan-groups"), null, { timeout: 30000 }).catch(() => {});
    await sleep(500);
    const savedA = state.saved?.assessments?.find((x) => x.id === "writing-demo");
    const scoredOf = (id) => (savedA?.responses || []).filter((r) => r.studentId === id && r.rubricScore !== undefined);
    check(scoredOf(A.id).length === 2 && scoredOf(B.id).length === 2, `${tag}: both students scored on both traits (rubric path)`);
    const aPages = new Set(savedA?.studentUploadIds?.[A.id] || []);
    check((savedA?.studentUploadIds?.[A.id] || []).length === 3 && (savedA?.studentUploadIds?.[B.id] || []).length === 3, `${tag}: three pages saved per student`);
    check([...(savedA?.studentUploadIds?.[B.id] || [])].every((p) => !aPages.has(p)), `${tag}: the two students' pages do not overlap`);
    check(state.writingReqs.length === 2 && state.writingReqs.every((q) => q.pages === 3), `${tag}: one writing call per student, each with its 3 pages`);
    check(state.reserveCalls >= 1, `${tag}: the stack was reserved up front (${state.reserveCalls})`);

    // Must-hold 5: reload brings the saved scores and pages back.
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    await page.getByRole("button", { name: /One student at a time/ }).click().catch(() => {});
    await page.waitForTimeout(400);
    const afterReload = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    check(/Answer|Cite Evidence/.test(afterReload), `${tag}: the rubric traits and their saved scores come back after a reload`);

    check(errors.length === 0, `${tag}: no page errors ${errors.join(" | ")}`);
    await page.screenshot({ path: join(OUT, `writing-class-set-${W}.png`) });
  } catch (e) {
    fail.push(`${tag}: stopped -- ${String(e.message || e).split("\n")[0]} ${errors.join(" | ")}`);
    await page.screenshot({ path: join(OUT, `writing-class-set-FAILED-${W}.png`) });
  }
  await ctx.close();
}

// Must-hold 1 (the block): two piles read as the SAME student -> scoring is
// blocked until the teacher gives one of them a different student.
{
  const { ctx, state } = await makeContext(browser, { W: 390, H: 844, roster, sameName: true });
  const page = await ctx.newPage();
  try {
    await openCamera(page);
    await captureTwoStudents(page);
    const scoreBtn = page.getByRole("button", { name: /^Score 2 students$/ });
    check(await scoreBtn.isDisabled(), `dup: scoring is blocked while two piles are the same student`);
    const txt = (await page.locator(".class-scan-groups").innerText()).replace(/\s+/g, " ");
    check(/Two papers are matched to the same student/.test(txt), `dup: the duplicate is called out`);
    // Resolve it: leave the second pile out (the matcher is a custom Select; the
    // discard button is the plain way to resolve a duplicate). Once only one
    // pile remains for that student, scoring is allowed again.
    await page.getByRole("button", { name: "Discard this group" }).nth(1).click();
    await page.waitForTimeout(400);
    const score1 = page.getByRole("button", { name: /^Score 1 student$/ });
    check(!(await score1.isDisabled().catch(() => true)), `dup: once the duplicate is resolved, scoring is allowed`);
    await score1.click();
    await page.waitForFunction(() => !document.querySelector(".class-scan-groups"), null, { timeout: 30000 }).catch(() => {});
    await sleep(400);
    const savedA = state.saved?.assessments?.find((x) => x.id === "writing-demo");
    const ids = Object.keys(savedA?.studentUploadIds || {}).filter((id) => (savedA.studentUploadIds[id] || []).length);
    check(ids.length === 1, `dup: only the kept pile scored, under its own student (${ids.length})`);
    const all = ids.flatMap((id) => savedA.studentUploadIds[id]);
    check(new Set(all).size === all.length, `dup: no page is under two students`);
  } catch (e) {
    fail.push(`dup: stopped -- ${String(e.message || e).split("\n")[0]}`);
    await page.screenshot({ path: join(OUT, "writing-class-set-FAILED-dup.png") });
  }
  await ctx.close();
}

// Must-hold 6: a 402 on the up-front reservation shows the out-of-credits
// message, not "score by hand".
{
  const { ctx, state } = await makeContext(browser, { W: 390, H: 844, roster, reserve402: true });
  const page = await ctx.newPage();
  const toasts = [];
  page.on("console", () => {});
  try {
    await openCamera(page);
    await shoot(page, 2);
    await page.getByRole("button", { name: /^Finished$/ }).click();
    // Grade reserves the stack up front -> the mocked 402 stops it here.
    const grade = page.getByRole("button", { name: /^Grade\b/ });
    await grade.waitFor({ state: "visible", timeout: 30000 });
    await grade.click();
    await page.waitForTimeout(1200);
    const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    toasts.push(body);
    check(state.reserveCalls >= 1, `402: the reservation was attempted`);
    check(/scans left|out of|credit|plan/i.test(body) && !/score by hand/i.test(body), `402: an out-of-credits message is shown, not "score by hand"`);
  } catch (e) {
    fail.push(`402: stopped -- ${String(e.message || e).split("\n")[0]}`);
    await page.screenshot({ path: join(OUT, "writing-class-set-FAILED-402.png") });
  }
  await ctx.close();
}

await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
