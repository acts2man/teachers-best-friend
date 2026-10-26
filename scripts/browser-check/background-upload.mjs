// Background upload (Ricky, 26 Oct 2026), driven through the real in-app
// camera with Chromium's fake camera: three students of 2, 2 and 1 pages.
//
// Proven when, at 390x844 and 412x915: nothing uploads while a student is
// still being photographed (so a mistaken photo can still be deleted -- the
// check deletes one); each student's pages start uploading as soon as Next
// student is tapped, while the next student is being photographed; a page
// already handed over can no longer be deleted in the camera; Finished
// uploads only the last student; and grading then sends exactly the three
// students, 2, 2 and 1 pages, in the order they were scanned.
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

const browser = await chromium.launch({
  executablePath: CHROMIUM,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});

for (const [W, H] of [[390, 844], [412, 915]]) {
  const tag = `${W}x${H}`;
  const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
  w.classes = w.classes.map((c) => ({ ...c, demo: false }));
  const a = w.assessments.find((x) => x.id === "ela-demo");
  const questionIds = a.questions.filter((q) => !q.excluded).map((q) => q.id);
  const events = []; // { what, at }
  const mark = (what) => events.push({ what, at: Date.now() });
  let uploads = 0;
  const grading = [];
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, isMobile: true, hasTouch: true, permissions: ["camera"] });
  await ctx.route("**/api/workspace", (r) =>
    r.request().method() === "GET"
      ? r.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }))
      : r.fulfill(json({ revision: 8 })),
  );
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 500, used: 0, remaining: 500, can_scan: true })));
  await ctx.route("**/api/uploads**", async (r) => {
    if (r.request().method() !== "POST") return r.fulfill(json({}, 404));
    uploads++;
    mark("upload");
    // Slow enough that an upload is visibly still going while the next
    // student is photographed.
    await sleep(700);
    return r.fulfill(json({ id: "upload-" + uploads, name: "page.jpg", size: 90000, mime: "image/jpeg", pages: 1 }));
  });
  await ctx.route("**/api/scans/reserve", (r) => r.fulfill(json({ charged: 5, alreadyPaid: 0, remaining: 400 })));
  await ctx.route("**/api/scans/release", (r) => r.fulfill(json({ ok: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  // The account copy, as the real endpoint keeps it: what this device saved.
  const remote = { state: null, revision: 0 };
  await ctx.route("**/api/scans/session**", (r) => {
    const m = r.request().method();
    if (m === "GET") return r.fulfill(json(remote));
    if (m === "PUT") {
      remote.state = JSON.parse(r.request().postData() || "{}").state ?? null;
      remote.revision++;
      return r.fulfill(json({ revision: remote.revision, ok: true }));
    }
    remote.state = null;
    remote.revision = 0;
    return r.fulfill(json({ ok: true }));
  });
  await ctx.route("**/api/analyze", async (r) => {
    const p = JSON.parse(r.request().postData() || "{}");
    if (p.mode === "name_strip")
      return r.fulfill(json({ model: "mock", result: { pages: p.uploadIds.map((_, i) => ({ page: i, name: "", confidence: 0, box: null })) } }));
    if (p.mode === "class_scan") {
      grading.push(p.pageGroups.map((g) => g.length));
      return r.fulfill(json({ model: "mock", result: { groups: p.pageGroups.map((_, k) => ({
        group: k,
        responses: questionIds.map((questionId) => ({ questionId, answer: "demo", verdict: "other", finalAnswer: "demo" })),
      })) } }));
    }
    return r.fulfill(json({ error: "unexpected mode " + p.mode }, 400));
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  // The app's error boundary catches a render error, so read the console too.
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text().slice(0, 300)));
  const shutter = page.locator("button.scan-camera-shutter");
  const shoot = async (n) => {
    for (let i = 0; i < n; i++) {
      const before = await page.locator(".scan-camera-thumb").count();
      const more = () => page.waitForFunction((b) => document.querySelectorAll(".scan-camera-thumb").length > b, before, { timeout: 4000 }).then(() => true, () => false);
      for (let tries = 0; tries < 5; tries++) {
        await shutter.click({ timeout: 20000 });
        // A fake camera frame can read as blurry: keep it.
        const keep = page.getByRole("button", { name: "Keep anyway" });
        if (await keep.waitFor({ timeout: 1500 }).then(() => true, () => false)) await keep.click();
        if (await more()) break;
      }
      await sleep(250);
    }
  };
  try {
    await page.goto(`${BASE}/assessments?id=ela-demo&tab=responses`, { waitUntil: "networkidle", timeout: 30000 });
    await page.getByRole("button", { name: /Scan student work/ }).click();
    await page.waitForFunction(() => {
      const b = document.querySelector("button.scan-camera-shutter");
      return b && !b.disabled;
    }, null, { timeout: 30000 });

    // Manual shutter only: auto-snap skips a blurry frame silently, and could
    // add shots on its own.
    const autoBtn = page.locator("button[aria-pressed]", { hasText: "Auto" }).first();
    if ((await autoBtn.getAttribute("aria-pressed")) === "true") await autoBtn.click();
    // Student 1: three photos, the last a mistake that is deleted.
    await shoot(3);
    await sleep(500);
    check(uploads === 0, `${tag}: nothing uploads while student 1 is being photographed (${uploads})`);
    await page.getByRole("button", { name: "Delete page 3" }).click();
    await page.waitForFunction(() => document.querySelectorAll(".scan-camera-thumb").length === 2);
    check(true, `${tag}: a mistaken photo is deleted before Next student`);
    mark("next1");
    await page.getByRole("button", { name: /Next student/ }).click();
    // Student 2 is photographed while student 1 uploads.
    await shoot(2);
    const next1 = events.find((e) => e.what === "next1").at;
    const firstUpload = events.find((e) => e.what === "upload")?.at ?? Infinity;
    check(firstUpload >= next1 && firstUpload - next1 < 3000, `${tag}: student 1 starts uploading at Next student (${firstUpload - next1} ms after)`);
    check(uploads > 0, `${tag}: student 1 is uploading while student 2 is photographed (${uploads} uploads so far)`);
    const sent = page.locator(".scan-camera-thumb.sent");
    check((await sent.count()) === 2 && (await sent.first().isDisabled()), `${tag}: student 1's pages are marked sent and cannot be deleted here`);
    await page.screenshot({ path: join(OUT, `background-upload-camera-${tag}.png`) });
    mark("next2");
    await page.getByRole("button", { name: /Next student/ }).click();
    await shoot(1);
    // Let students 1 and 2 finish before Finished, as they would while the
    // teacher photographs a class.
    await sleep(6000);
    const before = uploads;
    mark("finished");
    await page.getByRole("button", { name: /^Finished$/ }).click();
    await page.getByRole("button", { name: /^Grade/ }).first().waitFor({ timeout: 30000 });
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /^Grade/.test(x.textContent.trim()));
      return b && !b.disabled;
    }, null, { timeout: 30000 });
    // Each page uploads twice (the page and its name area).
    check(before === 8, `${tag}: students 1 and 2 (4 pages, 8 uploads) were uploaded before Finished (${before})`);
    check(uploads - before === 2, `${tag}: Finished uploads only student 3 (${uploads - before} uploads)`);
    await page.getByRole("button", { name: /^Grade/ }).first().click();
    await page.getByRole("button", { name: /Confirm & save 3 students/ }).waitFor({ timeout: 30000 });
    check(JSON.stringify(grading.flat()) === JSON.stringify([2, 2, 1]), `${tag}: graded as three students of 2, 2 and 1 pages, in order (${JSON.stringify(grading)})`);
  } catch (e) {
    fail.push(`${tag}: stopped -- ${String(e.message || e).split("\n")[0]}`);
    await page.screenshot({ path: join(OUT, `background-upload-FAILED-${tag}.png`) });
  }
  check(errors.length === 0, `${tag}: no page errors ${errors.join(" | ")}`);
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
