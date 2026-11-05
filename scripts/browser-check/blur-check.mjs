// Camera blur check (Ricky, 29 Oct 2026), in the real in-app camera at
// 390x844 and 412x915, fed Chromium's fake camera with a made-up page (the
// camera-controls.mjs page): sharp, and the same page out of focus (a
// Gaussian blur, sigma 3 px). Proven when:
//   - the first open shows "Best results: stand and hold the phone over the
//     page." and a second open does not;
//   - a sharp photo is added at once, with no question;
//   - a blurry photo asks "This photo looks blurry" with Retake and Keep:
//     Retake adds nothing, Keep adds the photo;
//   - nothing is uploaded or sent for any of it.
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

/** The camera-controls.mjs page as a .y4m, optionally out of focus. */
function pageVideo(name, sigma) {
  const W = 720, H = 1280, FRAMES = 6, pw = 620, ph = 1080;
  let y = new Float32Array(W * H).fill(50);
  const x0 = Math.round((W - pw) / 2), y0 = Math.round((H - ph) / 2);
  for (let r = y0; r < y0 + ph; r++) for (let c = x0; c < x0 + pw; c++) y[r * W + c] = 245;
  const step = Math.max(10, Math.round(ph / 28));
  for (let k = 3; k < 26; k++) {
    const r0 = y0 + k * step;
    if (r0 > y0 + ph - step) break;
    const len = Math.round(pw * (0.5 + (0.4 * ((k * 37) % 10)) / 10));
    for (let t = 0; t < Math.max(2, Math.round(pw / 160)); t++) for (let c = x0 + Math.round(pw * 0.08); c < x0 + len; c++) y[(r0 + t) * W + c] = 20;
  }
  if (sigma) {
    const rad = Math.ceil(sigma * 3), k = [];
    let s = 0;
    for (let i = -rad; i <= rad; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(v); s += v; }
    const kk = k.map((v) => v / s), tmp = new Float32Array(W * H), out = new Float32Array(W * H);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) { let a = 0; for (let i = -rad; i <= rad; i++) a += y[r * W + Math.min(W - 1, Math.max(0, c + i))] * kk[i + rad]; tmp[r * W + c] = a; }
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) { let a = 0; for (let i = -rad; i <= rad; i++) a += tmp[Math.min(H - 1, Math.max(0, r + i)) * W + c] * kk[i + rad]; out[r * W + c] = a; }
    y = out;
  }
  const yb = Buffer.from(Uint8Array.from(y, (v) => Math.max(0, Math.min(255, Math.round(v)))));
  const uv = Buffer.alloc((W / 2) * (H / 2) * 2, 128);
  const parts = [Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`)];
  for (let f = 0; f < FRAMES; f++) parts.push(Buffer.from("FRAME\n"), yb, uv);
  const file = join(tmpdir(), name + ".y4m");
  writeFileSync(file, Buffer.concat(parts));
  return file;
}
const SHARP = pageVideo("tbf-blur-sharp", 0);
const BLURRY = pageVideo("tbf-blur-blurry", 3);

async function openCamera(video, W, H, seenTip, keepAuto = false) {
  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--use-file-for-fake-video-capture=" + video],
  });
  const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
  w.classes = w.classes.map((c) => ({ ...c, demo: false }));
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, isMobile: true, hasTouch: true, permissions: ["camera"] });
  const sent = [];
  await ctx.route("**/api/uploads**", (r) => { sent.push("upload"); return r.fulfill(json({ id: "u", pages: 1 })); });
  await ctx.route("**/api/analyze**", (r) => { sent.push("analyze"); return r.fulfill(json({ error: "none" }, 500)); });
  await ctx.route("**/api/workspace", (r) =>
    r.request().method() === "GET"
      ? r.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }))
      : r.fulfill(json({ revision: 8 })),
  );
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 500, used: 0, remaining: 500, can_scan: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  await ctx.route("**/api/scans/session**", (r) => r.fulfill(json(r.request().method() === "GET" ? { state: null, revision: 0 } : { revision: 1, ok: true })));
  if (seenTip) await ctx.addInitScript(() => localStorage.setItem("tbf.camera.tip-seen", "1"));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  await page.goto(`${BASE}/assessments?id=ela-demo&tab=responses`, { waitUntil: "networkidle", timeout: 30000 });
  await page.getByRole("button", { name: /Scan student work/ }).click();
  await page.waitForFunction(() => { const b = document.querySelector("button.scan-camera-shutter"); return b && !b.disabled; }, null, { timeout: 30000 });
  const autoBtn = page.locator("button[aria-pressed]", { hasText: "Auto" }).first();
  if (!keepAuto && (await autoBtn.count()) && (await autoBtn.getAttribute("aria-pressed")) === "true") await autoBtn.click();
  if (keepAuto && (await autoBtn.count()) && (await autoBtn.getAttribute("aria-pressed")) !== "true") await autoBtn.click();
  await sleep(1200);
  return { browser, page, errors, sent };
}
const thumbs = (page) => page.locator(".scan-camera-thumb").count();

for (const [W, H] of [[390, 844], [412, 915]]) {
  const tag = `${W}x${H}`;
  {
    // Review of #200: Auto on, and the teacher presses the shutter herself on
    // a blurry page. It used to be dropped with only the auto-snap hint.
    const { browser, page, errors } = await openCamera(BLURRY, W, H, true, true);
    try {
      check((await page.locator("button[aria-pressed]", { hasText: "Auto" }).first().getAttribute("aria-pressed")) === "true", `${tag} auto: Auto is on`);
      await page.locator("button.scan-camera-shutter").click();
      const sheet = page.getByRole("dialog", { name: "Blurry photo" });
      const asked = await sheet.waitFor({ timeout: 8000 }).then(() => true, () => false);
      check(asked, `${tag} auto: a shutter press on a blurry page asks Retake / Keep`);
      if (asked) {
        await sheet.getByRole("button", { name: "Keep" }).click();
        await sleep(1200);
        check((await thumbs(page)) === 1, `${tag} auto: and Keep adds it`);
      }
      check(errors.length === 0, `${tag} auto: no page errors ${errors.join(" | ")}`);
    } catch (e) {
      fail.push(`${tag} auto: stopped -- ${String(e.message || e).split("\n")[0]}`);
    }
    await browser.close();
  }
  {
    const { browser, page, errors, sent } = await openCamera(SHARP, W, H, false);
    try {
      const tip = page.locator(".scan-camera-tip");
      check((await tip.count()) === 1 && /Best results: stand and hold the phone over the page\./.test(await tip.innerText()), `${tag}: the first open shows the tip`);
      await page.screenshot({ path: join(OUT, `blur-check-tip-${tag}.png`) });
      await page.locator("button.scan-camera-shutter").click();
      await sleep(1500);
      check((await page.getByRole("dialog", { name: "Blurry photo" }).count()) === 0, `${tag}: a sharp photo asks nothing`);
      check((await thumbs(page)) === 1, `${tag}: and is added at once`);
      check((await tip.count()) === 0, `${tag}: the tip goes once a photo is taken`);
      check(sent.length === 0, `${tag}: a sharp photo is checked without sending anything (${sent.join(", ")})`);
      check(errors.length === 0, `${tag}: sharp -- no page errors ${errors.join(" | ")}`);
    } catch (e) {
      fail.push(`${tag} sharp: stopped -- ${String(e.message || e).split("\n")[0]}`);
    }
    await browser.close();
  }
  {
    const { browser, page, errors, sent } = await openCamera(BLURRY, W, H, true);
    try {
      check((await page.locator(".scan-camera-tip").count()) === 0, `${tag}: a later open does not show the tip again`);
      await page.locator("button.scan-camera-shutter").click();
      const sheet = page.getByRole("dialog", { name: "Blurry photo" });
      await sheet.waitFor({ timeout: 8000 });
      check(/This photo looks blurry/.test(await sheet.innerText()), `${tag}: a blurry photo asks first`);
      const buttons = (await sheet.getByRole("button").allInnerTexts()).map((t) => t.trim());
      check(JSON.stringify(buttons) === JSON.stringify(["Retake", "Keep"]), `${tag}: with Retake and Keep (${buttons.join(", ")})`);
      await page.screenshot({ path: join(OUT, `blur-check-sheet-${tag}.png`) });
      await sheet.getByRole("button", { name: "Retake" }).click();
      await sleep(500);
      check((await thumbs(page)) === 0, `${tag}: Retake adds nothing`);
      await page.locator("button.scan-camera-shutter").click();
      await sheet.waitFor({ timeout: 8000 });
      await sheet.getByRole("button", { name: "Keep" }).click();
      await sleep(1200);
      check((await thumbs(page)) === 1, `${tag}: Keep adds the photo`);
      check(sent.length === 0, `${tag}: nothing uploaded or sent to check it (${sent.join(", ")})`);
      check(errors.length === 0, `${tag}: blurry -- no page errors ${errors.join(" | ")}`);
    } catch (e) {
      fail.push(`${tag} blurry: stopped -- ${String(e.message || e).split("\n")[0]}`);
      await page.screenshot({ path: join(OUT, `blur-check-FAILED-${tag}.png`) });
    }
    await browser.close();
  }
}
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
