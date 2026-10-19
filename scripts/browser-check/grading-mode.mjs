// The grading mode (docs/design/grading-modes-and-dok-grid.md, G1), in a
// browser at 390x844 and 1366x768.
//
// Proven when: a test shows a Grading switch with Percentage on; switching it
// to Standards-Based saves the test with gradingMode "sbg" and the teacher's
// last mode, and changes no grade, question or evidence in the save; the
// switch reads Standards-Based after a reload of what was saved; the setup
// screen for a new test starts in Standards-Based (the mode used last); and
// switching back saves the test exactly as it was. Nothing scrolls sideways.
// Seeded demo data only; /api/* is mocked and every save is captured.
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const SHOTS = process.env.SHOTS || join(OUT, "grading-mode");
const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const CHROMIUM = process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const pass = [];
const fail = [];
const check = (c, m) => (c ? pass : fail).push(m);
mkdirSync(SHOTS, { recursive: true });

const original = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
original.classes = original.classes.map((c) => ({ ...c, demo: false }));
const ID = "math-demo";
const strip = (a) => JSON.stringify({ ...a, gradingMode: undefined });

const browser = await chromium.launch({ executablePath: CHROMIUM });
for (const [W, H] of [[390, 844], [1366, 768]]) {
  const tag = `${W}x${H}`;
  let current = structuredClone(original);
  let saved = null;
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route("**/api/workspace", (r) => {
    if (r.request().method() === "GET")
      return r.fulfill(json({ workspace: current, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }));
    saved = JSON.parse(r.request().postData() || "{}").workspace;
    return r.fulfill(json({ revision: 8 }));
  });
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  await ctx.route("**/api/scans/session**", (r) => r.fulfill(json({ state: null, revision: 0 })));
  const page = await ctx.newPage();
  const pressed = async () =>
    page.$$eval(".grading-mode-row .grading-mode-choice button", (bs) => bs.filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.innerText.trim()));
  const noSideScroll = async (where) =>
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${tag} ${where}: no sideways scroll`);

  await page.goto(`${BASE}/assessments?id=${ID}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".grading-mode-row", { timeout: 15000 });
  check(JSON.stringify(await pressed()) === JSON.stringify(["Percentage"]), `${tag} test page: Grading switch reads Percentage (${await pressed()})`);
  await noSideScroll("test page");
  await page.locator(".grading-mode-row").screenshot({ path: join(SHOTS, `switch-percentage-${tag}.png`) });

  await page.getByRole("button", { name: "Standards-Based (0–4)" }).click();
  await page.waitForFunction(() => document.querySelector(".grading-mode-row button[aria-pressed=true]")?.innerText.includes("Standards"), null, { timeout: 10000 });
  const before = original.assessments.find((a) => a.id === ID);
  const after = saved?.assessments.find((a) => a.id === ID);
  check(after?.gradingMode === "sbg", `${tag} switch: the save carries gradingMode "sbg" (${after?.gradingMode})`);
  check(saved?.settings.lastGradingMode === "sbg", `${tag} switch: the save remembers Standards-Based as the last mode`);
  check(!!after && strip(after) === strip(before), `${tag} switch: no grade, question or point changed in the save`);
  check(JSON.stringify(saved?.students) === JSON.stringify(original.students), `${tag} switch: no evidence changed`);
  check(saved?.assessments.filter((a) => a.id !== ID).every((a) => !a.gradingMode), `${tag} switch: no other test changed mode`);
  check(/Until then this test still\s+shows percentages/.test(await page.locator(".grading-mode-row").innerText()), `${tag} switch: says scores still show as percentages for now`);
  await page.locator(".grading-mode-row").screenshot({ path: join(SHOTS, `switch-sbg-${tag}.png`) });

  // Reload what was saved.
  current = saved;
  await page.goto(`${BASE}/assessments?id=${ID}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".grading-mode-row");
  check(JSON.stringify(await pressed()) === JSON.stringify(["Standards-Based (0–4)"]), `${tag} reload: the switch still reads Standards-Based (${await pressed()})`);

  // A new test starts in the mode used last.
  await page.goto(`${BASE}/scan`, { waitUntil: "networkidle" });
  const setup = page.locator(".grading-mode-choice").first();
  await setup.waitFor({ timeout: 15000 });
  const setupPressed = await setup.locator("button[aria-pressed=true]").innerText();
  check(setupPressed.trim() === "Standards-Based (0–4)", `${tag} setup: a new test starts in the last mode (${setupPressed.trim()})`);
  await noSideScroll("setup");
  await setup.locator("xpath=..").screenshot({ path: join(SHOTS, `setup-${tag}.png`) });

  // Switch back: exactly the test it was.
  await page.goto(`${BASE}/assessments?id=${ID}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".grading-mode-row");
  await page.getByRole("button", { name: "Percentage" }).click();
  await page.waitForFunction(() => document.querySelector(".grading-mode-row button[aria-pressed=true]")?.innerText === "Percentage", null, { timeout: 10000 });
  const back = saved.assessments.find((a) => a.id === ID);
  check(JSON.stringify(back) === JSON.stringify(before), `${tag} switch back: the saved test is exactly the original`);
  check(saved.settings.lastGradingMode === "percentage", `${tag} switch back: Percentage is now the last mode`);
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
