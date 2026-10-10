// "Check what each question measures" table, on a desktop (reported by Michael
// on Windows): a long question ran into the Skill & standard column and a long
// standard code overlapped the question. We seed one question with a long
// sentence and a long standard code, render the report at a desktop width, and
// check the Question cell and the Skill & standard cell do not overlap and that
// neither cell overflows its own box.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const CHROMIUM = process.env.CHROMIUM || "/opt/pw-browsers/chromium/chrome-linux/chrome";
const workspace = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));

// Seed a long question + long standard on the first question of math-demo.
const asmt = workspace.assessments.find((a) => a.id === "math-demo");
if (!asmt || !asmt.questions?.length) {
  console.error("fixture has no math-demo questions to seed");
  process.exit(1);
}
asmt.questions[0].text =
  "A rectangular garden measures 12 and three quarter metres along one side and " +
  "8 and one half metres along the other; if a path of uniform width runs around " +
  "the whole of its outside, what is the total area the gardener must cover?";
asmt.questions[0].standard = "CCSS.MATH.CONTENT.7.G.B.6.EXTENDED.REASONING.LONGCODE";
asmt.questions[0].skill = "Area and perimeter of composite figures with rational side lengths";

const browser = await chromium.launch({ executablePath: CHROMIUM });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
await ctx.route("**/api/workspace", (r) =>
  r.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ workspace, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }),
  }));
await ctx.route("**/api/quota", (r) =>
  r.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true }),
  }));

const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 180)); });
page.on("pageerror", (e) => errors.push("UNCAUGHT: " + String(e).slice(0, 180)));
const real = () => errors.filter((e) => !/supabase\.co|net::|Failed to fetch|ERR_|Failed to load resource|401|503/i.test(e));

const pass = [];
const fail = [];
const check = (cond, msg) => (cond ? pass : fail).push(msg);

await page.goto(`${BASE}/assessments?id=math-demo&tab=questions`, { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(800);

const table = page.locator(".report-table table").first();
check((await table.count()) > 0, "the measures table renders on desktop");

const row = page.locator(".report-table tbody tr").first();
const qCell = row.locator("td").nth(0);
const sCell = row.locator("td").nth(1);
const qBox = await qCell.boundingBox();
const sBox = await sCell.boundingBox();
check(!!qBox && !!sBox, "found the Question and Skill cells");

// No horizontal overlap: the Question cell ends at or before the Skill cell begins.
const gap = sBox.x - (qBox.x + qBox.width);
check(gap >= -1, `Question cell does not cross into Skill & standard (gap ${Math.round(gap)}px)`);

// Neither text cell overflows its own box (content wraps, not spills).
const overflow = await row.evaluate((tr) => {
  const over = (el) => (el ? el.scrollWidth - el.clientWidth : 0);
  const tds = tr.querySelectorAll("td");
  return { q: over(tds[0]), s: over(tds[1]) };
});
check(overflow.q <= 1, `Question cell content stays within its box (overflow ${overflow.q}px)`);
check(overflow.s <= 1, `Skill & standard content stays within its box (overflow ${overflow.s}px)`);

// The long question actually wrapped to more than one line (proves it is not
// just sitting on one nowrap line that happens to fit).
const lines = await qCell.evaluate((td) => {
  // The text span is the unclassed one inside the question-cell button.
  const spans = [...td.querySelectorAll(".question-cell > span")];
  const span = spans.find((s) => /rectangular garden/.test(s.textContent || ""));
  if (!span) return 0;
  const lh = parseFloat(getComputedStyle(span).lineHeight) || 20;
  return Math.round(span.getBoundingClientRect().height / lh);
});
check(lines >= 2, `the long question wraps to multiple lines (${lines})`);

const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
check(!hscroll, "no horizontal page scroll at desktop width");

console.log("=== MEASURES TABLE DESKTOP CHECK (1366x900) ===");
for (const p of pass) console.log("  OK   " + p);
for (const f of fail) console.log("  FAIL " + f);
console.log("\nconsole errors (excluding blocked supabase):", real().length ? "\n  " + real().join("\n  ") : "none");
console.log(`\n${pass.length}/${pass.length + fail.length} assertions passed`);
await browser.close();
process.exit(fail.length || real().length ? 1 : 0);
