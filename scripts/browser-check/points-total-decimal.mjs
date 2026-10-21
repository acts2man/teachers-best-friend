// A 2.5-point test through the Edit dialog (#170 follow-up), in a browser at
// 390x844 and 1366x768.
//
// Proven when: a test worth 2.5 points (its questions worth 0.5, 0.5 and
// 0.25 each for the rest) opens the Edit dialog at "2.5"; renaming it saves
// the new title with the total still 2.5 and every question's own points
// unchanged; after a reload of what was saved the questions tab still says
// "Total: 2.5 points" and the dialog still opens at "2.5". The browser accepts
// 2.5 in the input (it refused it before: step 1). Seeded demo data only;
// /api/* is mocked and every save is captured.
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const SHOTS = process.env.SHOTS || join(OUT, "points-total-decimal");
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
const a0 = original.assessments.find((a) => a.id === ID);
const WORTH = [0.5, 0.5, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25]; // 2.5 in all
a0.questions.forEach((q, i) => (q.points = WORTH[i]));
a0.pointsPossible = 2.5;
const pointsOf = (a) => a.questions.map((q) => q.points);

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
  const openEdit = async () => {
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "Edit assessment" });
    await dialog.waitFor();
    return dialog;
  };

  await page.goto(`${BASE}/assessments?id=${ID}&tab=questions`, { waitUntil: "networkidle" });
  await page.waitForSelector(".assignment-status-bar", { timeout: 15000 });
  let dialog = await openEdit();
  const total = dialog.locator('input[type="number"]');
  check((await total.inputValue()) === "2.5", `${tag}: the Edit dialog opens at 2.5 (${await total.inputValue()})`);
  check(await total.evaluate((el) => el.checkValidity()), `${tag}: the browser accepts 2.5 in the total`);
  await dialog.locator("input").first().fill("Multiplication quiz (renamed)");
  await dialog.screenshot({ path: join(SHOTS, `edit-${tag}.png`) });
  await dialog.getByRole("button", { name: "Save assessment" }).click();
  await dialog.waitFor({ state: "hidden", timeout: 10000 });
  const after = saved?.assessments.find((a) => a.id === ID);
  check(after?.title === "Multiplication quiz (renamed)", `${tag}: the rename is saved (${after?.title})`);
  check(after?.pointsPossible === 2.5, `${tag}: the saved total is still 2.5 (${after?.pointsPossible})`);
  check(JSON.stringify(after && pointsOf(after)) === JSON.stringify(WORTH), `${tag}: every question's own points unchanged (${after && pointsOf(after)})`);

  // Reload what was saved.
  current = saved;
  await page.goto(`${BASE}/assessments?id=${ID}&tab=questions`, { waitUntil: "networkidle" });
  await page.waitForSelector(".assignment-status-bar");
  const body = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  check(/Total: 2\.5 points/.test(body), `${tag}: after reload the questions tab says "Total: 2.5 points"`);
  dialog = await openEdit();
  check((await dialog.locator('input[type="number"]').inputValue()) === "2.5", `${tag}: after reload the Edit dialog still opens at 2.5`);
  check(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), `${tag}: no sideways scroll`);
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
