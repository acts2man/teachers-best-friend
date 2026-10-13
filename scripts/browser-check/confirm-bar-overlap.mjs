// #126 review, item 2b, and round 3, item 1b: on short phones the pinned green
// "Confirm N answers" bar covered the next group's "Points" box and "Give ...
// to all N" button (360x640) and "Reteach these N" (390x844); after the first
// fix, which watched only the credit form, taps aimed at "Grade on their own",
// "Change", the "No error type" picker and "All questions" still hit the bar.
//
// What this proves, at 360x640, 390x844 and 412x915, for EVERY control on the
// page (anything tappable, the same list the app watches):
//   1. Where the app itself leaves the teacher after giving credit, nothing is
//      under the bar.
//   2. At the bottom of the page, nothing is under it (the spacer).
//   3. Every control in the panel, brought into view the way the browser does
//      when it is focused, leaves the showing bar clear.
//   4. At every scroll position 20px apart, no control is under the showing
//      bar -- neither by its box nor by where a tap on it actually lands
//      (elementFromPoint at its centre and corners).
// The bar keeps that promise by tucking itself away; the sweep also reports
// (INFO, not pass/fail) how often it is showing, which is the cost.
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

// Round 3: EVERY control a teacher can tap, anywhere on the page -- "Grade on
// their own", "Change", the error-type picker, "All questions" were all hit
// under the bar when only the credit form was watched. Same list the app uses.
const TAPPABLE =
  "a[href], button, input:not([type=hidden]), select, textarea, summary, label[for], " +
  "[role=button], [role=link], [role=combobox], [role=checkbox], [role=radio], [role=tab], " +
  "[tabindex]:not([tabindex='-1']):not([role=tabpanel])";

async function covered(page) {
  return page.evaluate((sel) => {
    const wrap = document.querySelector(".confirm-matches-bar");
    // Tucked away (slid off the bottom, not tappable): covering nothing.
    if (wrap?.classList.contains("is-tucked")) return { bar: true, tucked: true, hits: [], taps: [] };
    const btn = document.querySelector(".confirm-matches-bar .confirm-matches");
    const bar = btn?.getBoundingClientRect();
    if (!bar) return { bar: false, hits: [], taps: [] };
    const label = (el) => (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().replace(/\s+/g, " ").slice(0, 40);
    const visible = [...document.querySelectorAll(sel)]
      .filter((el) => !wrap.contains(el) && !el.closest("[inert]"))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width && r.height && r.bottom > 0 && r.top < innerHeight);
    // Any part of a control under the button.
    const hits = visible
      .filter(({ r }) => r.bottom > bar.top && r.top < bar.bottom && r.right > bar.left && r.left < bar.right)
      .map(({ el }) => label(el));
    // And what a tap actually reaches: probe each control's visible points
    // (centre, corners inset 2px) -- any that lands on the bar is a mis-tap.
    const taps = [];
    for (const { el, r } of visible) {
      const pts = [[(r.left + r.right) / 2, (r.top + r.bottom) / 2], [r.left + 2, r.top + 2], [r.right - 2, r.top + 2], [r.left + 2, r.bottom - 2], [r.right - 2, r.bottom - 2]];
      if (pts.some(([x, y]) => y >= 0 && y < innerHeight && x >= 0 && x < innerWidth && wrap.contains(document.elementFromPoint(x, y)))) taps.push(label(el));
    }
    return { bar: true, hits, taps };
  }, TAPPABLE);
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
  const landed = await covered(page);
  // Right after credit the app scrolls the next group's credit form into view;
  // the bar is either showing with nothing under it, or tucked for a control.
  check(landed.bar && landed.hits.length === 0, `${W}x${H}: right after giving credit nothing is under the bar${landed.tucked ? " (tucked away for a control)" : " (showing)"}${landed.hits.length ? " — under it: " + landed.hits.join(", ") : ""}`);
  await page.screenshot({ path: join(OUT, `bar-after-credit-${W}x${H}.png`) });

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(300);
  const bottom = await covered(page);
  check(bottom.hits.length === 0, `${W}x${H}: at the bottom of the page, nothing is under the bar${bottom.hits.length ? " — under it: " + bottom.hits.join(", ") : ""}`);
  await page.screenshot({ path: join(OUT, `bar-bottom-${W}x${H}.png`) });

  // Every control in the panel, scrolled into view the way the browser does
  // when it is focused: none ends up under the showing bar.
  const n = await page.locator(`#grade-by-question :is(${TAPPABLE})`).count();
  const blocked = [];
  for (let i = 0; i < n; i++) {
    const el = page.locator(`#grade-by-question :is(${TAPPABLE})`).nth(i);
    await page.evaluate(() => window.scrollTo(0, 0));
    await el.evaluate((e) => e.scrollIntoView({ block: "nearest" }));
    await page.waitForTimeout(80);
    const c = await covered(page);
    if (c.hits.length || c.taps.length) blocked.push(...new Set([...c.hits, ...c.taps]));
  }
  check(blocked.length === 0, `${W}x${H}: each of ${n} controls in the panel, scrolled into view, leaves the showing bar clear${blocked.length ? " — not: " + [...new Set(blocked)].join(", ") : ""}`);

  // Every scroll position, 20px apart: wherever the bar is showing, nothing
  // of a group's is under it (it tucks itself away instead).
  const total = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  let under = 0, positions = 0, tucked = 0;
  const names = new Set();
  for (let y = 0; y <= total; y += 20) {
    await page.evaluate((y) => window.scrollTo(0, y), y);
    await page.waitForTimeout(Number(process.env.SWEEP_WAIT || 40)); // a few frames for the bar to react
    positions++;
    const c = await covered(page);
    if (c.tucked) tucked++;
    if (c.hits.length || c.taps.length) {
      under++;
      [...c.hits, ...c.taps].forEach((x) => names.add(x));
    }
  }
  check(under === 0, `${W}x${H}: at every one of ${positions} scroll positions, no control is under the showing bar and no tap on one reaches it (${under} positions failed${names.size ? ": " + [...names].slice(0, 6).join(", ") : ""})`);
  // Not a pass/fail: how often the bar is there to tap at all.
  console.log(`  INFO ${W}x${H}: the bar shows at ${positions - tucked} of ${positions} scroll positions, tucked at ${tucked}`);

  // Round-2 review: the layout moving WITHOUT a scroll (a photo loading, a
  // group growing) must also be followed. Find a position where the bar is
  // tucked, then push the controls down so the strip clears.
  let y0 = -1;
  for (let y = 0; y <= total && y0 < 0; y += 20) {
    await page.evaluate((y) => window.scrollTo(0, y), y);
    await page.waitForTimeout(40);
    if ((await covered(page)).tucked) y0 = y;
  }
  if (y0 >= 0) {
    // Tucked: the button cannot be focused from the keyboard.
    const focusable = await page.evaluate(() => {
      const b = document.querySelector(".confirm-matches-bar .confirm-matches");
      b?.focus();
      return document.activeElement === b;
    });
    check(!focusable, `${W}x${H}: tucked away, the button cannot take keyboard focus`);
    // Move the layout twice with no scroll (a photo loading, a group growing,
    // then shrinking back). Each time the bar must match what is really under
    // its spot: tucked exactly when a control is there, never stale either way.
    const states = [];
    for (const pad of ["900px", "", "37px"]) {
      await page.evaluate((pad) => document.querySelectorAll("#grade-by-question .gbq-key").forEach((el) => (el.style.paddingBottom = pad)), pad);
      await page.waitForTimeout(150);
      const truth = await page.evaluate((sel) => {
        const wrap = document.querySelector(".confirm-matches-bar");
        const b = wrap.querySelector(".confirm-matches");
        const bottom = innerHeight - (parseFloat(getComputedStyle(wrap).bottom) || 0);
        const left = (innerWidth - b.offsetWidth) / 2;
        const z = { top: bottom - b.offsetHeight - 8, bottom: bottom + 8, left: left - 8, right: left + b.offsetWidth + 8 };
        const under = [...document.querySelectorAll(sel)]
          .filter((el) => !wrap.contains(el) && !el.closest("[inert]"))
          .some((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > z.top && r.top < z.bottom && r.right > z.left && r.left < z.right; });
        return { under, tucked: wrap.classList.contains("is-tucked") };
      }, TAPPABLE);
      states.push(truth);
    }
    check(states.every((t) => t.under === t.tucked), `${W}x${H}: after the layout moved 3 times with no scroll, the bar followed each time (${states.map((t) => (t.tucked ? "tucked" : "showing") + (t.under === t.tucked ? "" : " WRONG")).join(", ")})`);
  }
  await ctx.close();
}
await browser.close();
console.log("=== GREEN BAR vs EVERY CONTROL ===");
for (const p of pass) console.log("  OK   " + p);
for (const f of fail) console.log("  FAIL " + f);
console.log(`\n${pass.length}/${pass.length + fail.length} assertions passed`);
process.exit(fail.length ? 1 : 0);
