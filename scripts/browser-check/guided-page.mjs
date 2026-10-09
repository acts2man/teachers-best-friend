// Batch 4 guided-page + speed-lane check, at phone size (390x844), on the
// merged build, with the app's own demo workspace mocked in. Reruns the check
// recorded in PR #109 after merging main (Batches 1-3 + #108).
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const CHROMIUM = process.env.CHROMIUM || "/opt/pw-browsers/chromium/chrome-linux/chrome";
const workspace = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));

const browser = await chromium.launch({ executablePath: CHROMIUM });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.route("**/api/workspace", (r) =>
  r.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ workspace, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }) }));
await ctx.route("**/api/quota", (r) =>
  r.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true }) }));

const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 180)); });
page.on("pageerror", (e) => errors.push("UNCAUGHT: " + String(e).slice(0, 180)));

const real = () => errors.filter((e) => !/supabase\.co|net::|Failed to fetch|ERR_|Failed to load resource|401|503/i.test(e));
async function hscroll() {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}
const pass = [];
const fail = [];
const check = (cond, msg) => (cond ? pass : fail).push(msg);

// 1. SPEED LANE -- the question list of an assessment that needs review.
await page.goto(`${BASE}/assessments?id=math-demo&tab=questions`, { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(800);
const strong = await page.locator(".align-strong").count();
const weak = await page.locator(".align-weak-score").count();
const confirmAll = page.getByRole("button", { name: /Looks good .* confirm all/i });
const hadConfirmAll = (await confirmAll.count()) > 0;
check(strong + weak > 0, `speed-lane badges render (strong=${strong}, weak=${weak})`);
check(hadConfirmAll, `"Looks good — confirm all" button present`);
const inlineBadges = await page.locator(".align-inline").count();
check(inlineBadges > 0, `per-question inline badge present on phone (${inlineBadges})`);
check(!(await hscroll()), "speed lane: no horizontal scroll");

// Confirm-all in one tap, then it should move on to the answer key.
let confirmAllWorked = "not run";
if (hadConfirmAll) {
  await confirmAll.first().click();
  await page.waitForTimeout(900);
  const onKey = /2\.?\s*Answer key|Answer key/i.test(await page.locator("body").innerText());
  confirmAllWorked = onKey ? "moved to answer key" : "clicked, key step not detected";
  check(onKey, `confirm-all moves to the answer key (${confirmAllWorked})`);
}

// 2. GUIDED STUDENT-WORK PAGE -- the Student work tab (ClassScanPanel leads it).
// ela-demo is Ready (standards + key confirmed), so the Scan button is enabled;
// a not-ready assessment shows "confirm standards first" here instead, by design.
await page.goto(`${BASE}/assessments?id=ela-demo&tab=responses`, { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(900);
const steps = await page.locator(".guided-steps").count();
const stepsText = steps ? (await page.locator(".guided-steps").innerText()).replace(/\s+/g, " ").trim() : "";
const bigBtn = await page.locator(".guided-primary").count();
const bigBtnText = bigBtn ? (await page.locator(".guided-primary").first().innerText()).replace(/\s+/g, " ").trim() : "";
const moreOptions = await page.locator(".more-options").count();
const moreOpen = moreOptions ? await page.locator(".more-options").first().evaluate((el) => el.open) : null;
check(steps > 0, `guided step marker renders: "${stepsText}"`);
check(/1.*Scan student work.*2.*Match names.*3.*Grade/i.test(stepsText), "step marker reads Scan · Match · Grade");
check(bigBtn > 0 && /Scan/i.test(bigBtnText), `one big Scan button: "${bigBtnText}"`);
check(moreOptions > 0 && moreOpen === false, `More options present and collapsed (open=${moreOpen})`);
check(!(await hscroll()), "guided page: no horizontal scroll");

// 3. ?student= opens the per-student section.
await page.goto(`${BASE}/scan?assessment=math-demo&mode=responses&student=s1`, { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(900);
const bodyText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
check(/Amelia/i.test(bodyText), "?student=s1 surfaces that student (Amelia)");
check(!(await hscroll()), "per-student view: no horizontal scroll");

console.log("=== GUIDED-PAGE + SPEED-LANE CHECK (390x844) ===");
for (const p of pass) console.log("  OK   " + p);
for (const f of fail) console.log("  FAIL " + f);
console.log("\nconsole errors (excluding blocked supabase):", real().length ? "\n  " + real().join("\n  ") : "none");
console.log(`\n${pass.length}/${pass.length + fail.length} assertions passed`);
await browser.close();
process.exit(fail.length || real().length ? 1 : 0);
