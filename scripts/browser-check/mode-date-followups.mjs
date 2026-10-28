// Reviews of #191/#192, in a browser at 390x844 and 1366x768:
//   (a) a Percentage test's "Use this assessment in" dialog lists the
//       Percentage class and not the Standards-Based one, and says why;
//   (d) the class super grid says it counts students now on the roster.
// Demo data; /api/* mocked.
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
  const fw = w.classes[0].framework;
  w.classes = [
    ...w.classes.map((c) => ({ ...c, demo: false, gradingMode: "percentage" })),
    { id: "room-9", name: "Room 9", grade: 4, framework: fw, demo: false, gradingMode: "sbg" },
    { id: "room-10", name: "Room 10", grade: 4, framework: fw, demo: false, gradingMode: "percentage" },
  ];
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
    await page.goto(`${BASE}/assessments?id=math-demo`, { waitUntil: "networkidle" });
    await page.locator(".linked-classes").getByRole("button").first().click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ timeout: 10000 });
    const text = (await dialog.innerText()).replace(/\s+/g, " ");
    check(/Room 10/.test(text) && !/Room 9/.test(text.replace(/1 other class.*/, "")), `${tag}: (a) only the Percentage class is offered ("${text.slice(0, 160)}")`);
    check(/1 other class is graded Standards-Based, so it can't share this test\./.test(text), `${tag}: (a) and the teacher is told why`);
    check(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag}: (a) the dialog fits`);
    await page.keyboard.press("Escape");
    await page.goto(`${BASE}/lessons`, { waitUntil: "networkidle" });
    const head = (await page.locator(".class-super-grid .super-grid-head").innerText()).replace(/\s+/g, " ");
    check(/Counts students now on this class.s roster\./.test(head), `${tag}: (d) the super grid says whose answers it counts`);
    check(errors.length === 0, `${tag}: no page errors ${errors.join(" | ")}`);
  } catch (e) {
    fail.push(`${tag}: stopped -- ${String(e.message || e).split("\n")[0]}`);
    await page.screenshot({ path: join(OUT, `mode-date-followups-FAILED-${W}.png`) });
  }
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
