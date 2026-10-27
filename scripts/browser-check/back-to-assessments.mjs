// Ricky (phone): inside a test, "All assessments" did not go back.
//
// Proven when, at 390x844 and 412x915 (and 360x780 and 1366x768), on a test
// opened from the list -- on each of its tabs, scrolled to the top and
// scrolled down -- the "All assessments" button is the element under its own
// centre (nothing covers it), and tapping it shows the list of assessments
// with the URL at /assessments. Also after a tab change (?id=..&tab=..) and
// after opening the test straight from a link (a full page load -- the case
// that failed: a refresh, a shared link, or the phone reloading the tab after
// the camera). After going back: the browser's Back button returns to the
// test, a card in the list still opens a test, and another page still opens.
// Seeded demo data with made-up questions; /api/* is mocked.
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const SHOTS = process.env.SHOTS || join(OUT, "back-to-assessments");
const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const CHROMIUM = process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const pass = [];
const fail = [];
const check = (c, m) => (c ? pass : fail).push(m);
mkdirSync(SHOTS, { recursive: true });

const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
w.classes = w.classes.map((c) => ({ ...c, demo: false }));

const browser = await chromium.launch({ executablePath: CHROMIUM });
for (const [W, H] of [[390, 844], [412, 915], [360, 780], [1366, 768]]) {
  const phone = W < 700;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, isMobile: phone, hasTouch: phone });
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
  page.on("pageerror", (e) => errors.push(e.message));

  const back = async (tag, how) => {
    const btn = page.locator("button.back-link", { hasText: "All assessments" });
    await btn.waitFor({ timeout: 10000 });
    const hit = await btn.evaluate((b) => {
      const r = b.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const top = document.elementFromPoint(x, y);
      return {
        inView: r.top >= 0 && r.bottom <= innerHeight,
        covered: !!top && !b.contains(top),
        by: top && !b.contains(top) ? (top.className?.toString() || top.tagName) : "",
        box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      };
    });
    if (hit.inView) check(!hit.covered, `${tag}: the button is not covered${hit.covered ? " -- covered by " + hit.by + " at " + hit.box : ""}`);
    await page.screenshot({ path: join(SHOTS, `${W}x${H}-${tag.replace(/\W+/g, "-")}.png`) });
    if (phone) await btn.tap({ timeout: 5000 }).catch((e) => fail.push(`${tag}: tap failed: ${e.message.split("\n")[0]}`));
    else await btn.click({ timeout: 5000 }).catch((e) => fail.push(`${tag}: click failed: ${e.message.split("\n")[0]}`));
    const ok = await page
      .waitForFunction(() => location.search === "" && location.pathname === "/assessments" && !document.querySelector("button.back-link"), null, { timeout: 5000 })
      .then(() => true, () => false);
    const url = page.url().replace(BASE, "");
    check(ok, `${tag}: ${how} goes back to the list (url ${url})`);
  };

  const tag = (s) => `${W}x${H} ${s}`;
  // Opened from the list.
  await page.goto(`${BASE}/assessments`, { waitUntil: "networkidle" });
  for (const tab of ["questions", "analysis", "responses"]) {
    await page.goto(`${BASE}/assessments`, { waitUntil: "networkidle" });
    await page.locator(".assessment-list button, .assessment-row, [data-assessment-id]").first().waitFor({ timeout: 10000 }).catch(() => {});
    await page.goto(`${BASE}/assessments?id=math-demo&tab=${tab}`, { waitUntil: "networkidle" });
    await back(tag(`${tab} tab, top`), "tapping All assessments");
    await page.goto(`${BASE}/assessments?id=math-demo&tab=${tab}`, { waitUntil: "networkidle" });
    await page.locator("button.back-link").waitFor();
    await page.mouse.wheel(0, 600);
    await page.evaluate(() => window.scrollBy(0, 600));
    await page.waitForTimeout(300);
    await page.locator("button.back-link").scrollIntoViewIfNeeded();
    await back(tag(`${tab} tab, scrolled`), "tapping All assessments");
  }
  // Opened by tapping a card in the list, then a tab.
  await page.goto(`${BASE}/assessments`, { waitUntil: "networkidle" });
  const card = page.locator("main button", { hasText: w.assessments.find((a) => a.id === "math-demo").title }).first();
  if (await card.count()) {
    await (phone ? card.tap() : card.click());
    await page.locator("button.back-link").waitFor({ timeout: 10000 });
    await back(tag("opened from the list"), "tapping All assessments");
  } else fail.push(tag("no card for math-demo in the list"));
  // After the fix's pushState: the router still works both ways.
  await page.goto(`${BASE}/assessments?id=math-demo&tab=analysis`, { waitUntil: "networkidle" });
  await back(tag("full load, then"), "tapping All assessments");
  await page.goBack();
  const backToTest = await page.locator("button.back-link").waitFor({ timeout: 5000 }).then(() => true, () => false);
  check(backToTest && /id=math-demo/.test(page.url()), tag(`the browser's Back button returns to the test (${page.url().replace(BASE, "")})`));
  await back(tag("after browser Back"), "tapping All assessments again");
  const again = page.locator("main button", { hasText: w.assessments.find((a) => a.id === "math-demo").title }).first();
  await (phone ? again.tap() : again.click());
  const reopened = await page.locator("button.back-link").waitFor({ timeout: 5000 }).then(() => true, () => false);
  check(reopened && /id=math-demo/.test(page.url()), tag(`a card in the list opens the test again (${page.url().replace(BASE, "")})`));
  await page.evaluate(() => window.next.router.push("/students"));
  const other = await page.waitForURL(/\/students$/, { timeout: 5000 }).then(() => true, () => false);
  check(other, tag(`another page still opens (${page.url().replace(BASE, "")})`));
  check(!errors.length, tag(`no page errors${errors.length ? " -- " + errors.join(" | ") : ""}`));
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
