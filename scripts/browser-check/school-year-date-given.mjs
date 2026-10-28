// School year + date given (27 Oct 2026), in a browser at 390x844 and
// 1366x768. Proven when: sign-up offers the school year, starting on the
// current one; Settings shows it and saves a change; a test page shows its
// date given (the day it was created when never recorded, with a note) and
// saves an edit, which a reload shows; and nothing scrolls sideways.
// Seeded demo data only; /api/* is mocked and every save is kept. Sign-up is
// not submitted (no account is made).
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
const now = new Date();
const year = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
const label = (y) => y + "–" + String((y + 1) % 100).padStart(2, "0");

const browser = await chromium.launch({ executablePath: CHROMIUM });
for (const [W, H] of [[390, 844], [1366, 768]]) {
  const tag = `${W}x${H}`;
  let current = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
  current.classes = current.classes.map((c) => ({ ...c, demo: false }));
  const math = current.assessments.find((a) => a.id === "math-demo");
  delete math.dateGiven;
  math.createdAt = "2026-09-15T15:00:00Z";
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route("**/api/workspace", (r) => {
    if (r.request().method() === "GET") return r.fulfill(json({ workspace: current, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }));
    current = JSON.parse(r.request().postData()).workspace;
    return r.fulfill(json({ revision: 8 }));
  });
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  await ctx.route("**/api/scans/session**", (r) => r.fulfill(json({ state: null, revision: 0 })));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  const sideScroll = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  try {
    // Sign-up: the school year, starting on the current one.
    await page.goto(`${BASE}/login?mode=signup`, { waitUntil: "networkidle" });
    const select = page.getByLabel("School year");
    await select.waitFor({ timeout: 10000 });
    const chosen = await select.evaluate((s) => s.options[s.selectedIndex].text);
    const options = await select.evaluate((s) => [...s.options].map((o) => o.text));
    check(chosen === label(year), `${tag}: sign-up offers the school year, on ${label(year)} (${chosen})`);
    check(JSON.stringify(options) === JSON.stringify([label(year - 1), label(year), label(year + 1)]), `${tag}: last, this and next year (${options.join(", ")})`);
    check(!(await sideScroll()), `${tag}: sign-up fits`);
    await page.screenshot({ path: join(OUT, `school-year-signup-${W}.png`) });
    // Sign-in has no school year.
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    check((await page.getByLabel("School year").count()) === 0, `${tag}: sign-in does not ask`);

    // Settings: shows the current year, saves a change.
    await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
    const pick = page.getByRole("combobox", { name: "School year" });
    await pick.waitFor({ timeout: 10000 });
    check((await pick.innerText()).includes(label(year)), `${tag}: Settings shows ${label(year)} ("${(await pick.innerText()).trim()}")`);
    await pick.click();
    await page.getByRole("option", { name: label(year - 1) }).click();
    await page.waitForTimeout(800);
    check(current.settings.schoolYear === year - 1, `${tag}: and saves a change (${current.settings.schoolYear})`);
    check(!(await sideScroll()), `${tag}: Settings fits`);

    // A test's date given.
    await page.goto(`${BASE}/assessments?id=math-demo`, { waitUntil: "networkidle" });
    const date = page.getByLabel("Date given");
    await date.waitFor({ timeout: 10000 });
    const created = new Date("2026-09-15T15:00:00Z");
    const createdDay = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, "0")}-${String(created.getDate()).padStart(2, "0")}`;
    check((await date.inputValue()) === createdDay, `${tag}: a test with no date given shows the day it was created (${await date.inputValue()})`);
    check(/Not recorded yet/.test(await page.locator(".date-given-row").innerText()), `${tag}: and says so`);
    await date.fill("2026-10-21");
    await page.waitForTimeout(800);
    check(current.assessments.find((a) => a.id === "math-demo").dateGiven === "2026-10-21", `${tag}: an edit is saved`);
    await page.reload({ waitUntil: "networkidle" });
    await page.getByLabel("Date given").waitFor({ timeout: 10000 });
    check((await page.getByLabel("Date given").inputValue()) === "2026-10-21", `${tag}: and a reload shows it`);
    check(!/Not recorded yet/.test(await page.locator(".date-given-row").innerText()), `${tag}: with no note now`);
    check(!(await sideScroll()), `${tag}: the test page fits`);
    await page.locator(".date-given-row").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(OUT, `school-year-date-given-${W}.png`) });
    // Nothing is hidden: both tests still listed.
    await page.goto(`${BASE}/assessments`, { waitUntil: "networkidle" });
    const listed = await page.getByText(/Whole numbers|Reading/).count();
    check(listed >= 2, `${tag}: every test still listed (${listed})`);
    check(errors.length === 0, `${tag}: no page errors ${errors.join(" | ")}`);
  } catch (e) {
    fail.push(`${tag}: stopped -- ${String(e.message || e).split("\n")[0]}`);
    await page.screenshot({ path: join(OUT, `school-year-FAILED-${W}.png`) });
  }
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
