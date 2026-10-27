// Background upload, review round 2 (27 Oct 2026), in the real in-app camera
// with Chromium's fake camera at 390x844 and 412x915: three students, the
// second's page failing every upload try -- still retrying when Finished is
// pressed.
//
// Proven when that page waits with Retry on the scan screen and in exactly
// that one place: not also in the camera's saved copy (IndexedDB), and not
// offered again when the camera reopens.
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
  let failNext = 0;
  let uploadMs = 700;
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
    if (failNext > 0) {
      // Every try of this page's upload fails (uploadFile tries 3 times).
      failNext--;
      await sleep(1000);
      return r.fulfill(json({ error: "storage unavailable" }, 503));
    }
    uploads++;
    mark("upload");
    // Slow enough that an upload is visibly still going while the next
    // student is photographed.
    await sleep(uploadMs);
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
  const savedCopies = () =>
    page.evaluate(
      (id) =>
        new Promise((res) => {
          const open = indexedDB.open("tbf-scan-camera");
          open.onsuccess = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains("shots")) return res(0);
            const req = db.transaction("shots").objectStore("shots").index("assessmentId").count(id);
            req.onsuccess = () => res(req.result);
            req.onerror = () => res(-1);
          };
          open.onerror = () => res(-1);
        }),
      "ela-demo",
    );
  try {
    await page.goto(`${BASE}/assessments?id=ela-demo&tab=responses`, { waitUntil: "networkidle", timeout: 30000 });
    await page.getByRole("button", { name: /Scan student work/ }).click();
    await page.waitForFunction(() => {
      const b = document.querySelector("button.scan-camera-shutter");
      return b && !b.disabled;
    }, null, { timeout: 30000 });
    const autoBtn = page.locator("button[aria-pressed]", { hasText: "Auto" }).first();
    if ((await autoBtn.getAttribute("aria-pressed")) === "true") await autoBtn.click();
    // Student 1 uploads fine.
    await shoot(1);
    await page.getByRole("button", { name: /Next student/ }).click();
    for (let t = 0; t < 50 && uploads < 2; t++) await sleep(100);
    // Student 2's page fails every try -- and Finished is pressed while it is
    // still retrying, so the failure is settled after Finished.
    await shoot(1);
    failNext = 3;
    await page.getByRole("button", { name: /Next student/ }).click();
    await shoot(1);
    await page.getByRole("button", { name: /^Finished$/ }).click();
    // Wait for the scan screen to settle: student 3 in, student 2 waiting.
    const retry = page.getByRole("button", { name: /^Retry$/ });
    await retry.first().waitFor({ timeout: 30000 });
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /^Grade/.test(x.textContent.trim()));
      return b && !b.disabled;
    }, null, { timeout: 30000 });
    await sleep(800);
    check((await retry.count()) === 1, `${tag}: the failed page waits with Retry on the scan screen (${await retry.count()})`);
    const copies = await savedCopies();
    check(copies === 0, `${tag}: and is not also in the camera's saved copy (${copies} saved)`);
    // Reopening the camera offers nothing to restore: no second copy.
    await page.getByRole("button", { name: /Scan (more )?student work/ }).first().click();
    await page.waitForFunction(() => {
      const b = document.querySelector("button.scan-camera-shutter");
      return b && !b.disabled;
    }, null, { timeout: 30000 });
    await sleep(1500);
    const offered = await page.getByRole("button", { name: /^Restore \d+ pages?$/ }).count();
    check(offered === 0, `${tag}: reopening the camera offers no duplicate of it`);
    check(errors.length === 0, `${tag}: no page errors ${errors.join(" | ")}`);
  } catch (e) {
    fail.push(`${tag}: stopped -- ${String(e.message || e).split("\n")[0]}`);
    await page.screenshot({ path: join(OUT, `background-upload-failed-FAILED-${tag}.png`) });
  }
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
