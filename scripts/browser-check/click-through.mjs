import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
// Set CHROMIUM to override; the default is where this repo's CI image keeps it.
const CHROMIUM = process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

mkdirSync(OUT, { recursive: true });
const workspace = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));

const browser = await chromium.launch({ executablePath: CHROMIUM });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });

// Stand in for the two endpoints that need a signed-in session. The payload
// is the app's own demo workspace, so the shape is exactly what
// get_workspace_json returns -- not something invented for the test.
await ctx.route("**/api/workspace", r => r.fulfill({
  status: 200, contentType: "application/json",
  body: JSON.stringify({ workspace, revision: 7, aiReady: true,
                         authProvider: "supabase", impersonating: null }) }));
// 12 of 150 left -> should render the amber "low" state of the new meter.
await ctx.route("**/api/quota", r => r.fulfill({
  status: 200, contentType: "application/json",
  body: JSON.stringify({ plan_id: "starter", quota: 150, used: 138,
                         remaining: 12, can_scan: true }) }));

const page = await ctx.newPage();
const errors = [];
page.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0,180)); });
page.on("pageerror", e => errors.push("UNCAUGHT: " + String(e).slice(0,180)));

async function look(label) {
  await page.waitForTimeout(700);
  const h1 = await page.locator("h1").first().innerText().catch(() => "(no h1)");
  const body = (await page.locator("body").innerText()).replace(/\s+/g," ");
  return { label, h1: h1.replace(/\s+/g," ").trim(), chars: body.length, body };
}

await page.goto(BASE + "/app", { waitUntil: "networkidle", timeout: 30000 });
const home = await look("/app");

console.log("=== APP SHELL ===");
console.log("h1:", home.h1);
console.log("sidebar links:", (await page.locator("nav a, .nav-link a, a.nav-link").allInnerTexts()).join(" | ").slice(0,200));
console.log("quota meter present:", await page.locator(".quota-meter").count() > 0);
if (await page.locator(".quota-meter").count()) {
  console.log("  text :", (await page.locator(".quota-meter").innerText()).replace(/\s+/g," "));
  console.log("  level:", await page.locator(".quota-meter").getAttribute("data-level"));
}
console.log("SAMPLE CLASSROOM banner:", (await page.locator(".demo-strip").count()) > 0);
console.log("student count on page:", (home.body.match(/Amelia R\.|Benjamin L\./g)||[]).length > 0 ? "demo names visible" : "none visible");

// Click every sidebar destination the way a teacher would.
const DEST = [
  ["Assessments","/assessments"], ["Lesson plans","/lessons"], ["Classes","/classes"],
  ["Standards","/standards"], ["How to use","/guide"],
];
console.log("\n=== CLICKING THROUGH THE SIDEBAR ===");
for (const [text, expect] of DEST) {
  try {
    await page.getByRole("link", { name: text, exact: false }).first().click({ timeout: 8000 });
    await page.waitForURL("**" + expect, { timeout: 12000 });
    const v = await look(text);
    console.log(`OK    ${text.padEnd(14)} -> ${expect.padEnd(14)} h1="${v.h1}" (${v.chars} chars)`);
  } catch (e) {
    console.log(`FAIL  ${text.padEnd(14)} -> ${expect.padEnd(14)} ${String(e).split("\n")[0].slice(0,110)}`);
  }
}

// Direct navigation to the screens reached from buttons, not the sidebar.
console.log("\n=== BUTTON-REACHED SCREENS ===");
for (const p of ["/students","/scan","/diagnostics","/resources","/settings","/support"]) {
  await page.goto(BASE + p, { waitUntil: "networkidle", timeout: 25000 });
  const v = await look(p);
  console.log(`${v.chars > 300 ? "OK   " : "THIN "} ${p.padEnd(14)} h1="${v.h1}" (${v.chars} chars)`);
}

await page.goto(BASE + "/app", { waitUntil: "networkidle" });
await page.screenshot({ path: join(OUT, "shot-app.png"), fullPage: false });
await page.goto(BASE + "/students", { waitUntil: "networkidle" });
await page.waitForTimeout(600);
await page.screenshot({ path: join(OUT, "shot-students.png"), fullPage: false });

console.log("\n=== CONSOLE ERRORS (excluding blocked supabase.co calls) ===");
const real = errors.filter(e => !/supabase\.co|net::|Failed to fetch|ERR_|Failed to load resource/i.test(e));
console.log(real.length ? real.join("\n") : "none");
await browser.close();
