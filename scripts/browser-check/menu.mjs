// The menu (Ricky, 23 Oct 2026), at 390x844 and 1366x768: the menu reads New
// assessment, Overview, Assessment Library, Classes, Lesson Planning, Student
// Reports; Overview offers the test opened last; Classes jumps to a class's
// super grid; Lesson Planning opens on the grid with "Data-driven lesson" and
// "Start from scratch"; Student Reports picks a student, shows their grid and
// opens both reports; All assessments is one tap from the library. Nothing
// scrolls sideways. Demo data with placeholder names; /api/* mocked.
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

const browser = await chromium.launch({ executablePath: CHROMIUM });
for (const [W, H] of [[390, 844], [1366, 768]]) {
  const tag = `${W}x${H}`;
  const phone = W < 768;
  const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
  w.classes = w.classes.map((c) => ({ ...c, demo: false }));
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route("**/api/workspace", (r) =>
    r.request().method() === "GET" ? r.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null })) : r.fulfill(json({ revision: 8 })),
  );
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  await ctx.route("**/api/analyze**", (r) => r.fulfill(json({}, 500)));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  const sideScroll = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  const menu = async () => {
    if (phone) {
      await page.locator(".mobile-menu").click();
      await page.locator('[data-mobile="true"]').waitFor({ timeout: 5000 });
      return page.locator('[data-mobile="true"]');
    }
    return page.locator(".app-sidebar");
  };
  try {
    // A test opened, then Overview offers it back.
    await page.goto(`${BASE}/assessments?id=ela-demo`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await page.goto(`${BASE}/app`, { waitUntil: "networkidle" });
    const resume = page.getByRole("region", { name: "Pick up where you left off" });
    await resume.waitFor({ timeout: 10000 });
    const elaTitle = w.assessments.find((a) => a.id === "ela-demo").title;
    check((await resume.innerText()).includes(elaTitle), `${tag}: Overview offers the test opened last ("${elaTitle}")`);
    check(!(await sideScroll()), `${tag}: Overview does not scroll sideways`);
    await page.screenshot({ path: join(OUT, `menu-overview-${W}.png`) });
    await resume.getByRole("button", { name: "Open it" }).click();
    await page.waitForURL(/\/assessments\?id=ela-demo/, { timeout: 8000 });
    check(true, `${tag}: "Open it" goes back into it`);

    // The menu order.
    const nav = await menu();
    const items = (await nav.locator(".nav-link").allInnerTexts()).map((t) => t.trim());
    check(JSON.stringify(items.slice(0, 5)) === JSON.stringify(["Overview", "Assessment Library", "Classes", "Lesson Planning", "Student Reports"]), `${tag}: menu order ${items.slice(0, 5).join(" / ")}`);
    const top = await nav.evaluate((el) => {
      const s = el.querySelector(".new-scan"), l = el.querySelector(".nav-link");
      return !!s && !!l && s.getBoundingClientRect().top < l.getBoundingClientRect().top;
    });
    check(top, `${tag}: New assessment is above them`);
    if (phone) await page.screenshot({ path: join(OUT, "menu-open-390.png") });
    await nav.getByRole("link", { name: "Assessment Library" }).click();
    await page.waitForURL(/\/library/, { timeout: 8000 });
    await page.getByRole("button", { name: "All assessments" }).click();
    await page.waitForURL(/\/assessments$/, { timeout: 8000 });
    check(true, `${tag}: All assessments is one tap from the Assessment Library`);

    // Classes -> the class super grid.
    await page.goto(`${BASE}/classes`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Class super grid for / }).first().click();
    await page.waitForURL(/\/lessons$/, { timeout: 8000 });
    await page.locator(".class-super-grid").waitFor({ timeout: 8000 });
    check(true, `${tag}: Classes has a shortcut to the class super grid`);

    // Lesson Planning: grid first, then the two starts.
    const start = page.getByRole("region", { name: "Start a lesson" });
    await start.waitFor({ timeout: 5000 });
    const gridAbove = await page.evaluate(() => {
      const g = document.querySelector(".class-super-grid"), s = document.querySelector(".lesson-start");
      return !!g && !!s && (g.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING) > 0;
    });
    check(gridAbove, `${tag}: Lesson Planning opens on the class super grid, then the two ways to start`);
    check((await start.getByRole("button", { name: "Data-driven lesson" }).isEnabled()) && (await start.getByRole("button", { name: "Start from scratch" }).isVisible()), `${tag}: "Data-driven lesson" and "Start from scratch"`);
    check(!(await sideScroll()), `${tag}: Lesson Planning does not scroll sideways`);
    await start.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(OUT, `menu-lessons-${W}.png`) });
    await start.getByRole("button", { name: "Data-driven lesson" }).click();
    await page.waitForURL(/start=data&standard=/, { timeout: 8000 });
    const ctxText = await page.locator(".reteach-context").first().innerText().catch(() => "");
    check(/Data-driven/.test(ctxText), `${tag}: Data-driven opens the builder on the class's weakest standard`);
    await page.goto(`${BASE}/lessons`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Start from scratch" }).click();
    await page.waitForURL(/start=scratch/, { timeout: 8000 });
    check((await page.locator(".page-tabs").count()) > 0, `${tag}: Start from scratch opens the builder`);

    // Student Reports.
    const nav2 = await menu();
    await nav2.getByRole("link", { name: "Student Reports" }).click();
    await page.waitForURL(/\/reports/, { timeout: 8000 });
    const picker = page.getByRole("combobox", { name: "Choose a student" });
    await picker.waitFor({ timeout: 8000 });
    check((await page.locator(".student-super-grid").count()) === 0, `${tag}: Student Reports opens with the picker first`);
    await picker.click();
    await page.getByRole("option").nth(1).click();
    await page.locator(".student-super-grid").waitFor({ timeout: 8000 });
    check(true, `${tag}: picking a student shows their super grid`);
    check(!(await sideScroll()), `${tag}: Student Reports does not scroll sideways`);
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, `menu-reports-${W}.png`) });
    for (const name of ["Student super grid report", "Standard Tracker report"]) {
      await page.getByRole("button", { name }).click();
      const d = page.getByRole("dialog");
      await d.waitFor({ timeout: 5000 });
      const head = (await d.locator("h2").first().innerText()).trim();
      check(head.startsWith(name), `${tag}: "${name}" opens it ("${head}")`);
      await d.getByRole("button", { name: "Close" }).first().click();
      await d.waitFor({ state: "detached", timeout: 5000 });
    }
    check(errors.length === 0, `${tag}: no page errors ${errors.join(" | ")}`);
  } catch (e) {
    fail.push(`${tag}: stopped -- ${String(e.message || e).split("\n")[0]}`);
    await page.screenshot({ path: join(OUT, `menu-FAILED-${W}.png`) });
  }
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
