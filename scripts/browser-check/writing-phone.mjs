// Writing test on a phone (Michael, 4 Nov 2026, Android/Brave), at 412x915
// (his screen) and 1366x768:
//   1. "Add student work" did nothing when tapped. It switched to the Student
//      writing tab, but on a phone the tabs sit below the summary, so the
//      switch happened off screen. Now the step comes into view.
//   2. The per-student upload opened the phone's own camera. Now "Take a
//      photo" opens the app's camera (the one with the framing guide and the
//      blur check), and "Add writing" is the file picker with named types --
//      not "image/*", which lets Android jump straight to its camera.
// Chromium's fake camera stands in for the phone's; /api/* mocked.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const CHROMIUM = process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const pass = [];
const fail = [];
const check = (c, m) => (c ? pass : fail).push(m);

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
for (const [W, H, mobile] of [[412, 915, true], [1366, 768, false]]) {
  const tag = `${W}x${H}`;
  const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
  w.classes = w.classes.map((c) => ({ ...c, demo: false }));
  const a = w.assessments.find((x) => x.id === "math-demo");
  const rubric = Array.from({ length: 7 }, (_, i) => ({ id: "t" + i, name: "Trait " + (i + 1), max: 4, descriptor: "Demo", standard: i % 2 ? "W.4.9" : "" }));
  // Michael's test as recorded: a "response" writing test, 7 traits.
  Object.assign(a, { subject: "ELA", elaArea: "writing", genre: "response", rubric, questions: [], responses: [], assignmentUploadIds: [], uploadIds: [] });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, isMobile: mobile, hasTouch: mobile, permissions: ["camera"] });
  await ctx.route("**/api/workspace", (r) =>
    r.request().method() === "GET" ? r.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null })) : r.fulfill(json({ revision: 8 })),
  );
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  // In view = in the top half of the screen: on main the tab row sat 796 px
  // down a 915 px screen with the panel below it, and on the real phone the
  // browser's own bars take another 100 px or more -- nothing changed in
  // sight, which is "it does nothing".
  const inView = (sel) =>
    page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.top >= 40 && r.top < innerHeight / 2;
    }, sel);
  try {
    await page.goto(BASE + "/assessments?id=math-demo", { waitUntil: "networkidle", timeout: 30000 });
    const add = page.getByRole("button", { name: "Add student work" });
    await add.waitFor({ timeout: 15000 });
    check(await add.isEnabled(), `${tag}: "Add student work" can be tapped`);
    await add.click();
    await page.getByRole("tab", { name: "2. Student writing", selected: true }).waitFor({ timeout: 5000 });
    await page.waitForTimeout(900);
    const tabsTop = await page.evaluate(() => Math.round(document.querySelector(".assessment-tabs")?.getBoundingClientRect().top ?? -999));
    check(await inView(".assessment-tabs"), `${tag}: the Student writing step is on screen after the tap (tabs at ${tabsTop} px)`);
    check(await inView(".assessment-tabs + * .panel, [role=tabpanel] .panel"), `${tag}: with the student writing panel in sight`);
    // The upload picker: named types, no straight-to-camera.
    const picker = page.locator('input[type="file"][aria-label^="Upload writing for"]');
    check((await picker.getAttribute("accept")) === "application/pdf,image/jpeg,image/png,image/webp", `${tag}: the file picker names its types (not image/*)`);
    check((await picker.getAttribute("capture")) === null, `${tag}: and does not ask for the phone camera`);
    const chooser = page.waitForEvent("filechooser", { timeout: 4000 }).then(() => true, () => false);
    await page.getByRole("button", { name: "Add writing" }).click();
    check(await chooser, `${tag}: "Add writing" opens the file picker`);
    // The app camera.
    await page.getByRole("button", { name: "Take a photo" }).click();
    const cam = page.locator(".scan-camera-shutter");
    const opened = await cam.waitFor({ timeout: 8000 }).then(() => true, () => false);
    check(opened, `${tag}: "Take a photo" opens the app camera, not the phone's`);
    await page.screenshot({ path: join(OUT, `writing-phone-camera-${W}.png`) });
    check(errors.length === 0, `${tag}: no page errors ${errors.join(" | ")}`);
  } catch (e) {
    fail.push(`${tag}: stopped -- ${String(e.message || e).split("\n")[0]}`);
    await page.screenshot({ path: join(OUT, `writing-phone-FAILED-${W}.png`) });
  }
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
