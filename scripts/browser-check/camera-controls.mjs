// Ricky's camera list (26 Oct 2026), in the real in-app camera at 390x844 and
// 412x915, fed a made-up video of a page (Chromium's fake camera reading a
// .y4m this script writes): the page far away, then close up.
//
// Proven when:
//   - "Next student" is to the right of the shutter and "Finished" to its left;
//   - the shutter's target is at least 96px, and a touch that lands near its
//     edge and slides before lifting still takes the photo;
//   - the counter reads "Student 1, Page 1" in bold (at least 20px, weight
//     700+) on one line, counts on with each photo, and starts again at Next
//     student;
//   - thumbnails are twice the old size (92x116), numbered, newest on the left;
//   - the framing guide says "Move closer" for the far page and "Hold steady"
//     for the close one, above the thumbnails, overlapping nothing.
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
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

/** A grey-scale .y4m of a white page with dark lines on a dark table. */
function pageVideo(name, pw, ph) {
  const W = 720, H = 1280, FRAMES = 6;
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
  const file = join(tmpdir(), name + ".y4m");
  writeFileSync(file, Buffer.concat(parts));
  return file;
}
const FAR = pageVideo("tbf-camera-far", 300, 390);
const CLOSE = pageVideo("tbf-camera-close", 620, 1080);

async function openCamera(video, W, H) {
  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--use-file-for-fake-video-capture=" + video],
  });
  const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
  w.classes = w.classes.map((c) => ({ ...c, demo: false }));
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, isMobile: true, hasTouch: true, permissions: ["camera"] });
  await ctx.route("**/api/workspace", (r) =>
    r.request().method() === "GET"
      ? r.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }))
      : r.fulfill(json({ revision: 8 })),
  );
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 500, used: 0, remaining: 500, can_scan: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  await ctx.route("**/api/scans/session**", (r) => r.fulfill(json(r.request().method() === "GET" ? { state: null, revision: 0 } : { revision: 1, ok: true })));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  await page.goto(`${BASE}/assessments?id=ela-demo&tab=responses`, { waitUntil: "networkidle", timeout: 30000 });
  await page.getByRole("button", { name: /Scan student work/ }).click();
  await page.waitForFunction(() => {
    const b = document.querySelector("button.scan-camera-shutter");
    return b && !b.disabled;
  }, null, { timeout: 30000 });
  // Manual: auto-snap would take photos of the close page on its own.
  const autoBtn = page.locator("button[aria-pressed]", { hasText: "Auto" }).first();
  if ((await autoBtn.count()) && (await autoBtn.getAttribute("aria-pressed")) === "true") await autoBtn.click();
  return { browser, page, errors };
}

const box = (page, sel) => page.locator(sel).first().boundingBox();
const thumbs = (page) => page.locator(".scan-camera-thumb").count();

for (const [W, H] of [[390, 844], [412, 915]]) {
  const tag = `${W}x${H}`;
  // ---- far page: layout, counter, shutter, thumbnails, "Move closer" ----
  {
    const { browser, page, errors } = await openCamera(FAR, W, H);
    try {
      const shutter = await box(page, "button.scan-camera-shutter");
      const next = await page.getByRole("button", { name: /Next student/ }).boundingBox();
      const finished = await page.getByRole("button", { name: /^Finished$/ }).boundingBox();
      check(next.x > shutter.x + shutter.width && finished.x + finished.width < shutter.x, `${tag}: Finished left of the shutter, Next student right of it`);
      check(shutter.width >= 96 && shutter.height >= 96, `${tag}: shutter target ${Math.round(shutter.width)}x${Math.round(shutter.height)}`);
      const count = page.locator(".scan-camera-count");
      const style = await count.evaluate((e) => ({ w: Number(getComputedStyle(e).fontWeight), s: parseFloat(getComputedStyle(e).fontSize) }));
      check((await count.innerText()).trim() === "Student 1, Page 1", `${tag}: the counter reads "${(await count.innerText()).trim()}"`);
      check(style.w >= 700 && style.s >= 20, `${tag}: the counter is bold and large (weight ${style.w}, ${style.s}px)`);
      const cb = await count.boundingBox();
      check(cb.height < style.s * 1.6, `${tag}: the counter is on one line (${Math.round(cb.height)}px tall)`);
      const guide = await page.locator(".scan-camera-guide").innerText({ timeout: 8000 }).catch(() => "");
      check(/Move closer/.test(guide), `${tag}: far page -- the guide says "${guide}"`);
      await page.screenshot({ path: join(OUT, `camera-far-${tag}.png`) });

      // A touch near the shutter's edge that slides 30px before lifting: as a
      // click it was lost; it takes the photo now.
      const cdp = await page.context().newCDPSession(page);
      const at = { x: shutter.x + shutter.width / 2 + 38, y: shutter.y + shutter.height / 2 };
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [at] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: at.x - 30, y: at.y - 6 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      const keep = page.getByRole("button", { name: "Keep anyway" });
      if (await keep.waitFor({ timeout: 2500 }).then(() => true, () => false)) await keep.click();
      const one = await page.waitForFunction(() => document.querySelectorAll(".scan-camera-thumb").length === 1, null, { timeout: 6000 }).then(() => true, () => false);
      check(one, `${tag}: a touch near the shutter's edge that slid before lifting took the photo`);
      // Two more, by plain taps.
      for (let i = 2; i <= 3; i++) {
        await page.touchscreen.tap(at.x - 20, at.y + 10);
        if (await keep.waitFor({ timeout: 2500 }).then(() => true, () => false)) await keep.click();
        await page.waitForFunction((n) => document.querySelectorAll(".scan-camera-thumb").length === n, i, { timeout: 6000 }).catch(() => {});
        await sleep(300);
      }
      check((await thumbs(page)) === 3, `${tag}: three photos (${await thumbs(page)})`);
      check((await count.innerText()).trim() === "Student 1, Page 4", `${tag}: the counter counts on ("${(await count.innerText()).trim()}")`);
      const t = await page.$$eval(".scan-camera-thumb", (els) => els.map((e) => ({ n: e.querySelector(".scan-camera-thumb-n")?.textContent.trim(), w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height), x: Math.round(e.getBoundingClientRect().left) })));
      check(JSON.stringify(t.map((x) => x.n)) === JSON.stringify(["3", "2", "1"]) && t[0].x < t[1].x, `${tag}: thumbnails numbered, newest on the left (${t.map((x) => x.n).join(", ")})`);
      check(t.every((x) => x.w === 92 && x.h === 116), `${tag}: thumbnails twice the old 46x58 (${t[0].w}x${t[0].h})`);
      // The guide, the thumbnails and the controls do not overlap.
      const g = await page.locator(".scan-camera-guide").boundingBox().catch(() => null);
      const firstThumb = await box(page, ".scan-camera-thumb");
      check(!!g && g.y + g.height <= firstThumb.y + 0.5, `${tag}: the guide sits above the thumbnails`);
      const ctl = await box(page, ".scan-camera-controls");
      check(firstThumb.y + firstThumb.height <= ctl.y + 0.5, `${tag}: the thumbnails sit above the controls`);
      await page.screenshot({ path: join(OUT, `camera-thumbs-${tag}.png`) });
      await page.getByRole("button", { name: /Next student/ }).click();
      check((await count.innerText()).trim() === "Student 2, Page 1", `${tag}: Next student starts the count again ("${(await count.innerText()).trim()}")`);
      check(errors.length === 0, `${tag}: no page errors ${errors.join(" | ")}`);
    } catch (e) {
      fail.push(`${tag} far: stopped -- ${String(e.message || e).split("\n")[0]}`);
      await page.screenshot({ path: join(OUT, `camera-FAILED-far-${tag}.png`) });
    }
    await browser.close();
  }
  // ---- close page: "Hold steady" ----
  {
    const { browser, page } = await openCamera(CLOSE, W, H);
    const guide = await page.waitForFunction(() => document.querySelector(".scan-camera-guide")?.textContent ?? null, null, { timeout: 8000 }).then((h) => h.jsonValue(), () => "");
    check(/Hold steady/.test(guide), `${tag}: close page -- the guide says "${guide}"`);
    await page.screenshot({ path: join(OUT, `camera-close-${tag}.png`) });
    await browser.close();
  }
}
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
