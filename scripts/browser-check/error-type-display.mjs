// Review of #190: off-list error tags are hidden on screen. At 390x844 and
// 1366x768, a test whose answers carry an old tag ("Sign error", written back
// by a stale tab), a current one ("Sign Error") and a typed Other label shows
// the current one and the label in the Class analysis, and never the old one
// -- nor on the grading screen's graded cards. Demo data; /api/* mocked.
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
  const math = w.assessments.find((a) => a.id === "math-demo");
  const wrong = math.responses.filter((r) => r.verified && !r.correct);
  wrong.slice(0, 4).forEach((r) => (r.errorType = "Sign error"));
  wrong.slice(4, 6).forEach((r) => (r.errorType = "Sign Error"));
  wrong.slice(6, 7).forEach((r) => (r.errorType = "Other: forgot to carry"));
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route("**/api/workspace", (r) =>
    r.request().method() === "GET"
      ? r.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }))
      : r.fulfill(json({ revision: 8 })),
  );
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  await ctx.route("**/api/scans/session**", (r) => r.fulfill(json({ state: null, revision: 0 })));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  try {
    await page.goto(`${BASE}/assessments?id=math-demo&tab=analysis`, { waitUntil: "networkidle" });
    await page.getByText(/Most common error types/i).first().waitFor({ timeout: 15000 });
    const text = await page.locator("main").innerText();
    check(!/Sign error/.test(text), `${tag}: the Class analysis never shows the old tag`);
    check(/Sign Error \(2\)/.test(text), `${tag}: it shows the current one, counted (2)`);
    check(/Other: forgot to carry \(1\)/.test(text), `${tag}: and the typed Other label`);
    await page.goto(`${BASE}/assessments?id=math-demo&tab=responses`, { waitUntil: "networkidle" });
    await page.locator("#grade-by-question").waitFor({ timeout: 15000 });
    const all = await page.locator("main").innerText();
    check(!/Sign error/.test(all), `${tag}: nor does Student work`);
    check(errors.length === 0, `${tag}: no page errors ${errors.join(" | ")}`);
  } catch (e) {
    fail.push(`${tag}: stopped -- ${String(e.message || e).split("\n")[0]}`);
    await page.screenshot({ path: join(OUT, `error-type-display-FAILED-${W}.png`) });
  }
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
