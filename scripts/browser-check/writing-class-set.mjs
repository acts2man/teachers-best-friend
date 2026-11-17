// Writing "Add student work" uses the class-set camera (Michael Zotzman,
// Nov 2026), at 390x844 (Android-sized) and 1366x768, fed Chromium's fake
// camera reading a .y4m page. Walks: open a writing test → Add student work →
// the class-set camera opens → capture 2 students × 3 pages, tapping "Next
// student" between them → the pages are matched to students and scored, and
// the save carries three pages and rubric-trait scores for each student.
// Demo data; /api/* mocked (no AI spend, no real camera).
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

/** A sharp .y4m of a white page with dark lines on a dark table (so the camera
 *  reads it as "Hold steady", not blurred). */
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

const browser = await chromium.launch({
  executablePath: CHROMIUM,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--use-file-for-fake-video-capture=" + VIDEO],
});
for (const [W, H] of [[390, 844], [1366, 768]]) {
  const tag = `${W}x${H}`;
  const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
  w.classes = w.classes.map((c) => ({ ...c, demo: false, gradingMode: "percentage" }));
  const roster = w.students.filter((s) => s.classId === w.activeClassId).slice(0, 2);
  const [A, B] = roster;
  w.assessments = [
    {
      id: "writing-demo", classId: w.activeClassId, title: "Opinion essay", subject: "ELA", elaArea: "writing",
      grade: w.classes[0].grade, framework: w.classes[0].framework, createdAt: "2026-11-17T00:00:00Z", status: "Ready",
      uploadIds: [], source: "manual", targetStandards: [], questions: [], genre: "informational", rubric: TRAITS,
      responses: [],
    },
    ...w.assessments,
  ];

  let saved = null;
  let uploadN = 0;
  let reserveCalls = 0;
  const writingReqs = [];
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, isMobile: W < 800, hasTouch: true, permissions: ["camera"] });
  await ctx.route("**/api/workspace", (r) =>
    r.request().method() === "GET"
      ? r.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }))
      : ((saved = JSON.parse(r.request().postData() || "{}")), r.fulfill(json({ revision: 8 }))),
  );
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 500, used: 0, remaining: 500, can_scan: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  await ctx.route("**/api/scans/session**", (r) => r.fulfill(json(r.request().method() === "GET" ? { state: null, revision: 0 } : { revision: 1, ok: true })));
  await ctx.route("**/api/scans/reserve", (r) => (reserveCalls++, r.fulfill(json({ charged: 0, alreadyPaid: 0, remaining: 500 }))));
  await ctx.route("**/api/uploads**", (r) => {
    if (r.request().method() !== "POST") return r.fulfill(json({}, 404));
    return r.fulfill(json({ id: "upload-" + ++uploadN, name: "page.jpg", size: 120000, mime: "image/jpeg", pages: 1 }));
  });
  await ctx.route("**/api/analyze", (r) => {
    const p = JSON.parse(r.request().postData() || "{}");
    if (p.mode === "name_strip") {
      // Each request is one student's strips. The first group's strips are the
      // even uploads 2,4,6; the second group's 8,10,12. Return that student's
      // exact roster name so each paper matches without the teacher picking.
      const first = p.uploadIds[0];
      const name = first === "upload-2" ? A.name : first === "upload-8" ? B.name : "";
      return r.fulfill(json({ result: { pages: [{ page: 0, name, confidence: 96, box: { x: 0.1, y: 0.05, width: 0.5, height: 0.08 } }] } }));
    }
    if (p.mode === "writing") {
      writingReqs.push({ studentId: p.studentId, pages: p.uploadIds.length });
      const responses = TRAITS.map((t, i) => ({
        id: p.studentId + t.id, studentId: p.studentId, questionId: t.id, answer: "", correct: i === 0,
        match: i === 0 ? 100 : 50, rubricScore: i === 0 ? 4 : 2, rubricReason: "demo", misconception: "", confidence: 100, verified: false,
      }));
      return r.fulfill(json({ result: { responses } }));
    }
    return r.fulfill(json({ result: {} }));
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  try {
    await page.goto(`${BASE}/assessments?id=writing-demo&tab=responses`, { waitUntil: "networkidle", timeout: 30000 });
    // Writing "Add student work" opens the class-set camera (not a one-student
    // upload). Scope to the Student-writing panel (the page header has its own
    // "Add student work" that only switches to this tab).
    const panel = page.locator(".panel", { hasText: "Photograph the whole class" });
    await panel.getByRole("button", { name: "Add student work" }).click();
    await page.waitForFunction(() => { const b = document.querySelector("button.scan-camera-shutter"); return b && !b.disabled; }, null, { timeout: 30000 });
    check(true, `${tag}: Add student work opens the class-set camera`);
    const auto = page.locator("button[aria-pressed]", { hasText: "Auto" }).first();
    if ((await auto.count()) && (await auto.getAttribute("aria-pressed")) === "true") await auto.click();

    // Student 1: three pages; Next student; student 2: three pages; Finished.
    await shoot(page, 3);
    await page.getByRole("button", { name: /Next student/ }).click();
    await shoot(page, 3);
    await page.getByRole("button", { name: /^Finished$/ }).click();

    // The matching screen: one row per student, each with its three pages.
    const groups = page.locator(".class-scan-groups .name-match-row");
    await groups.first().waitFor({ timeout: 30000 });
    check((await groups.count()) === 2, `${tag}: two students on the matching screen (${await groups.count()})`);
    const rowText = (await page.locator(".class-scan-groups").innerText()).replace(/\s+/g, " ");
    check((rowText.match(/3 pages/g) || []).length === 2, `${tag}: each student has three pages`);
    check(rowText.includes(A.name) && rowText.includes(B.name), `${tag}: both papers matched to their student by name`);

    // Score the class.
    await page.getByRole("button", { name: /^Score 2 students$/ }).click();
    await page.waitForFunction(() => !document.querySelector(".class-scan-groups"), null, { timeout: 30000 }).catch(() => {});
    await sleep(500);

    const ws = saved?.workspace || saved;
    const savedA = ws?.assessments?.find((x) => x.id === "writing-demo");
    const scoredOf = (id) => (savedA?.responses || []).filter((r) => r.studentId === id && r.rubricScore !== undefined);
    check(!!savedA, `${tag}: the save carried the writing assessment`);
    check(scoredOf(A.id).length === 2 && scoredOf(B.id).length === 2, `${tag}: both students got a score on both traits (rubric path)`);
    check((savedA?.studentUploadIds?.[A.id] || []).length === 3 && (savedA?.studentUploadIds?.[B.id] || []).length === 3, `${tag}: three pages saved per student`);
    const aPages = new Set(savedA?.studentUploadIds?.[A.id] || []);
    check([...(savedA?.studentUploadIds?.[B.id] || [])].every((p) => !aPages.has(p)), `${tag}: the two students' pages do not overlap`);
    check(writingReqs.length === 2 && writingReqs.every((q) => q.pages === 3), `${tag}: one writing grading call per student, each with its 3 pages`);
    check(reserveCalls === 0, `${tag}: no class_scan page reservation — the writing calls charge themselves (no double charge)`);
    check(errors.length === 0, `${tag}: no page errors ${errors.join(" | ")}`);
    await page.screenshot({ path: join(OUT, `writing-class-set-${W}.png`) });
  } catch (e) {
    fail.push(`${tag}: stopped -- ${String(e.message || e).split("\n")[0]} ${errors.join(" | ")}`);
    await page.screenshot({ path: join(OUT, `writing-class-set-FAILED-${W}.png`) });
  }
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
