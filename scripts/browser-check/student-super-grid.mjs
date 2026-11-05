// The student super grid (Ricky, 22 Oct 2026), at 390x844 and 1366x768:
// picking a student shows their own grid above Evidence by standard, a cell
// opens its panel with their score, the questions they answered (last 30 days
// and before), their weakest standards and error types, with no pre-teach
// button; nothing scrolls sideways; no request to the AI. Demo data with
// placeholder names; /api/* mocked.
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
  const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
  w.classes = w.classes.map((c) => ({ ...c, demo: false }));
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const ai = [];
  await ctx.route("**/api/analyze**", (r) => (ai.push(r.request().url()), r.fulfill(json({}, 500))));
  await ctx.route("**/api/workspace", (r) =>
    r.request().method() === "GET" ? r.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null })) : r.fulfill(json({ revision: 8 })),
  );
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  try {
    await page.goto(`${BASE}/students?id=s1`, { waitUntil: "networkidle" });
    const grid = page.locator(".student-super-grid");
    await grid.waitFor({ timeout: 15000 });
    check((await grid.locator("h2").innerText()).trim() === "Student super grid", `${tag}: the student's own grid is shown`);
    const rows = await grid.locator(".dok-grid-row").count();
    check(rows > 0, `${tag}: it has cluster rows (${rows})`);
    const below = await page.evaluate(() => {
      const g = document.querySelector(".student-super-grid");
      const e = [...document.querySelectorAll("h2, h3")].find((h) => /Evidence by standard/.test(h.textContent || ""));
      return !!g && !!e && (g.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING) > 0;
    });
    check(below, `${tag}: above Evidence by standard`);
    check(/on \d+ questions?/.test(await grid.innerText()), `${tag}: a cell says how many questions it rests on`);
    check(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag}: nothing scrolls sideways`);
    await grid.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(OUT, `student-super-grid-${W}.png`) });
    await grid.locator(".dok-cell:not(.level-none)").first().click();
    const panel = page.getByRole("dialog");
    await panel.waitFor({ timeout: 5000 });
    const text = await panel.innerText();
    check(/Questions answered this school year/.test(text) && /Last 30 days/.test(text) && /More than 30 days ago/.test(text), `${tag}: the panel counts the questions they answered, last 30 days and before`);
    check(/Weakest standards/.test(text) && /Common errors/.test(text), `${tag}: their weakest standards and common errors`);
    check(!/Plan a pre-teach lesson/.test(text), `${tag}: no pre-teach button for one student`);
    await page.screenshot({ path: join(OUT, `student-super-grid-panel-${W}.png`) });
    check(ai.length === 0, `${tag}: no AI request`);
    check(errors.length === 0, `${tag}: no page errors ${errors.join(" | ")}`);
  } catch (e) {
    fail.push(`${tag}: stopped -- ${String(e.message || e).split("\n")[0]}`);
    await page.screenshot({ path: join(OUT, `student-super-grid-FAILED-${W}.png`) });
  }
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
