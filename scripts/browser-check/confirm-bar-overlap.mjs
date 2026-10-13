// #126 review, item 2b: on short phones the pinned green "Confirm N answers"
// bar covered the next group's "Points" box and "Give ... to all N" button
// (360x640) and "Reteach these N" (390x844).
//
// What this proves, at 360x640, 390x844 and 412x915:
//   1. Where the app itself leaves the teacher after giving credit, no credit
//      control (Points box, Give button, Reteach button) is under the bar.
//   2. At the bottom of the page, none is under the bar (the spacer).
//   3. Every credit control, brought into view the way the browser does when
//      it is focused or scrolled to, ends up clear of the bar.
// What it cannot prove, and reports instead of hiding: a bar pinned to the
// bottom of the screen covers whatever the teacher is scrolling past at that
// moment. The sweep below counts those positions; it is the cost of the bar
// Ricky asked for, and the alternative (a button in the page, not pinned) is
// a decision for him.
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

function fixture() {
  const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
  w.classes = w.classes.map((c) => ({ ...c, demo: false }));
  const a = w.assessments.find((x) => x.id === "math-demo");
  const q1 = a.questions[0];
  const wrong = ["236", "240", "1,000", "12"];
  let i = 0;
  a.responses = a.responses.map((r) => {
    if (r.questionId !== q1.id) return { ...r, verified: true };
    const k = i++;
    // Half match the key; the rest fall into four different wrong-answer
    // groups, so after one is decided there is always a next one open.
    return k % 2 === 0
      ? { ...r, answer: q1.answer, finalAnswer: q1.answer, correct: true, match: 100, confidence: 100, verified: false, misconception: "" }
      : { ...r, answer: wrong[k % 4], finalAnswer: wrong[k % 4], correct: false, match: undefined, confidence: 100, verified: false, misconception: "" };
  });
  return w;
}

const CONTROLS = "#grade-by-question .gbq-group input[aria-label^='Points for the answer'], #grade-by-question .gbq-group .gbq-credit button, #grade-by-question .gbq-group button:has-text('Reteach')";

async function covered(page) {
  return page.evaluate((sel) => {
    const bar = document.querySelector(".confirm-matches-bar .confirm-matches")?.getBoundingClientRect();
    if (!bar) return { bar: false, hits: [] };
    const hits = [...document.querySelectorAll(sel)]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width && r.height && r.bottom > bar.top && r.top < bar.bottom && r.right > bar.left && r.left < bar.right)
      .map(({ el }) => (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40));
    return { bar: true, hits };
  }, CONTROLS.replace(/:has-text\('Reteach'\)/, "[data-reteach]"));
}

const browser = await chromium.launch({ executablePath: CHROMIUM });
for (const [W, H] of [[360, 640], [390, 844], [412, 915]]) {
  let current = fixture();
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
  await page.goto(`${BASE}/assessments?id=math-demo&tab=responses`, { waitUntil: "networkidle" });
  await page.locator("#grade-by-question").getByRole("button", { name: /^Review/ }).first().click();
  const points = page.locator("#grade-by-question input[aria-label^='Points for the answer']").first();
  await points.waitFor({ timeout: 10000 });
  await points.fill("0");
  await page.locator("#grade-by-question .gbq-credit").first().getByRole("button", { name: /^Give/ }).click();
  await page.locator(".confirm-matches-bar .confirm-matches").waitFor({ timeout: 10000 });
  await page.waitForTimeout(1200); // the smooth scroll to the next group
  await page.evaluate(() => document.querySelectorAll("#grade-by-question button").forEach((b) => /Reteach/.test(b.textContent || "") && b.setAttribute("data-reteach", "")));
  const landed = await covered(page);
  check(landed.bar && landed.hits.length === 0, `${W}x${H}: where the app leaves the teacher after giving credit, nothing is under the bar${landed.hits.length ? " — under it: " + landed.hits.join(", ") : ""}`);
  await page.screenshot({ path: join(OUT, `bar-after-credit-${W}x${H}.png`) });

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(300);
  const bottom = await covered(page);
  check(bottom.hits.length === 0, `${W}x${H}: at the bottom of the page, nothing is under the bar${bottom.hits.length ? " — under it: " + bottom.hits.join(", ") : ""}`);
  await page.screenshot({ path: join(OUT, `bar-bottom-${W}x${H}.png`) });

  const n = await page.locator(CONTROLS.replace(/:has-text\('Reteach'\)/, "[data-reteach]")).count();
  const blocked = [];
  for (let i = 0; i < n; i++) {
    const el = page.locator(CONTROLS.replace(/:has-text\('Reteach'\)/, "[data-reteach]")).nth(i);
    await page.evaluate(() => window.scrollTo(0, 0));
    await el.evaluate((e) => e.scrollIntoView({ block: "nearest" }));
    await page.waitForTimeout(80);
    const c = await covered(page);
    const label = await el.evaluate((e) => (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 40));
    if (c.hits.includes(label)) blocked.push(label);
  }
  check(blocked.length === 0, `${W}x${H}: each of ${n} credit controls, scrolled into view, is clear of the bar${blocked.length ? " — not: " + blocked.join(", ") : ""}`);

  // The honest part: a sweep of every scroll position, 40px apart.
  const total = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  let under = 0, positions = 0;
  for (let y = 0; y <= total; y += 40) {
    await page.evaluate((y) => window.scrollTo(0, y), y);
    positions++;
    if ((await covered(page)).hits.length) under++;
  }
  console.log(`  info ${W}x${H}: mid-scroll, a credit control passes under the pinned bar at ${under} of ${positions} scroll positions (inherent to a pinned bar)`);
  await ctx.close();
}
await browser.close();
console.log("=== GREEN BAR vs CREDIT CONTROLS ===");
for (const p of pass) console.log("  OK   " + p);
for (const f of fail) console.log("  FAIL " + f);
console.log(`\n${pass.length}/${pass.length + fail.length} assertions passed`);
process.exit(fail.length ? 1 : 0);
