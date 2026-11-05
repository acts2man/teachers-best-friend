// Class analysis folds (Ricky, 19 and 29 Oct 2026), at 390x844 and 1366x768:
// every section and every level group under a standard is open on arrival;
// closing a standard shows "code · score · level · reteach call"; closing a
// level group shows how many students it holds and hides their names; it
// opens again; nothing scrolls sideways. Demo data; /api/* mocked.
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
  await ctx.route("**/api/workspace", (r) =>
    r.request().method() === "GET"
      ? r.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }))
      : r.fulfill(json({ revision: 8 })),
  );
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  const sideScroll = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  try {
    await page.goto(`${BASE}/assessments?id=math-demo&tab=analysis`, { waitUntil: "networkidle" });
    await page.locator(".standard-card-body").first().waitFor({ timeout: 15000 });
    const all = await page.locator("details.collapsible").evaluateAll((d) => d.map((x) => x.open));
    check(all.length >= 6 && all.every(Boolean), `${tag}: every fold is open on arrival (${all.length})`);
    const card = page.locator(".student-group-card").first();
    const body = card.locator("details.standard-card-body");
    const names = await card.locator(".group-members button").count();
    check(names > 0, `${tag}: a standard lists its students (${names})`);
    await body.locator(":scope > summary").click();
    await body.locator(":scope > summary .collapsible-summary").waitFor({ timeout: 3000 });
    const closed = (await body.locator(":scope > summary").innerText()).replace(/\s+/g, " ");
    check(/\d\.[A-Z]+\.[A-Z]\.\d+ · (\d+% · [A-Za-z]+|not yet graded) · (reteach: [a-z ]+|no reteach needed)/.test(closed), `${tag}: closed, the standard says code · score · level · reteach call ("${closed.slice(0, 110)}")`);
    check(!(await card.locator(".group-members button").first().isVisible()), `${tag}: and its students are out of the way`);
    await body.locator(":scope > summary").click();
    const level = card.locator("details.level-students").first();
    await level.locator(":scope > summary").click();
    await level.locator(":scope > summary .collapsible-summary").waitFor({ timeout: 3000 });
    const levelText = (await level.locator(":scope > summary").innerText()).replace(/\s+/g, " ");
    check(/\(\d+\) \d+ students?$/.test(levelText.trim()), `${tag}: a closed level group says how many it holds ("${levelText.trim()}")`);
    check(!(await level.locator(".group-members").isVisible()), `${tag}: and hides the names`);
    await level.locator(":scope > summary").click();
    check(await level.locator(".group-members").isVisible(), `${tag}: it opens again`);
    const dok = page.locator("details.analysis-section", { hasText: "Depth of knowledge" }).first();
    await dok.locator(":scope > summary").click();
    await dok.locator(":scope > summary .collapsible-summary").waitFor({ timeout: 3000 });
    check(/\d+ standards? by DOK 1–4/.test(await dok.locator(":scope > summary").innerText()), `${tag}: a closed section has its one-line summary`);
    check(!(await sideScroll()), `${tag}: nothing scrolls sideways`);
    await page.screenshot({ path: join(OUT, `collapsible-analysis-${W}.png`), fullPage: false });
    check(errors.length === 0, `${tag}: no page errors ${errors.join(" | ")}`);
  } catch (e) {
    fail.push(`${tag}: stopped -- ${String(e.message || e).split("\n")[0]}`);
    await page.screenshot({ path: join(OUT, `collapsible-analysis-FAILED-${W}.png`) });
  }
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
