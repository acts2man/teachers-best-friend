// Does the Standards screen follow the classroom you switch to?
//
// Reading the database cannot answer this: the payload is identical whether
// the teacher signs in or an app manager views the account. The difference is
// what the screen does after the class changes underneath it.
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const CHROMIUM = process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
mkdirSync(OUT, { recursive: true });

const workspace = JSON.parse(readFileSync(join(OUT, "fixture-two-class.json"), "utf8"));
let revision = 7;

const browser = await chromium.launch({ executablePath: CHROMIUM });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });

await ctx.route("**/api/workspace", (route) => {
  if (route.request().method() === "PUT") {
    revision += 1;
    return route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ revision }) });
  }
  return route.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ workspace, revision, aiReady: true,
      authProvider: "supabase", impersonating: null }) });
});
await ctx.route("**/api/quota", (r) => r.fulfill({ status: 200, contentType: "application/json",
  body: JSON.stringify({ plan_id: "starter", quota: 150, used: 10, remaining: 140, can_scan: true }) }));

const page = await ctx.newPage();

async function readScreen() {
  await page.waitForTimeout(800);
  const pill = await page.locator(".library-intro .pill, .library-intro [class*=pill]").first()
    .innerText().catch(() => "?");
  const cards = await page.locator(".standard-card").count();
  const codes = (await page.locator(".standard-card .standard-code").allInnerTexts()).slice(0, 4);
  const shownClass = await page.locator(".class-switch button, .class-switch [role=combobox]").first()
    .innerText().catch(() => "?");
  return { pill: pill.replace(/\s+/g, " "), cards, codes, shownClass: shownClass.replace(/\s+/g, " ") };
}

async function switchTo(label) {
  await page.locator(".class-switch button, .class-switch [role=combobox]").first().click();
  await page.waitForTimeout(300);
  await page.getByRole("option", { name: label, exact: false }).first().click();
  await page.waitForTimeout(900);
}

await page.goto(BASE + "/standards", { waitUntil: "networkidle", timeout: 30000 });

console.log("The teacher opens Standards while Math 7 is the active class:");
let s = await readScreen();
console.log(`  class switcher: ${s.shownClass}`);
console.log(`  standards shown: ${s.cards}  (${s.pill})  ${s.codes.join(", ")}`);

console.log("\nThey switch to The Explorers (Grade 4, Common Core):");
await switchTo("The Explorers");
s = await readScreen();
console.log(`  class switcher: ${s.shownClass}`);
console.log(`  standards shown: ${s.cards}  (${s.pill})  ${s.codes.join(", ")}`);
const onGrade4 = s;

console.log("\nThey switch back to Math 7 (Grade 7, California):");
await switchTo("Math 7");
s = await readScreen();
console.log(`  class switcher: ${s.shownClass}`);
console.log(`  standards shown: ${s.cards}  (${s.pill})  ${s.codes.join(", ")}`);

const followed = onGrade4.codes.every((c) => c.startsWith("4.") || /^(RL|RI|L|W|SL|RF)\./.test(c))
  && s.codes.every((c) => c.startsWith("7."));
console.log(`\nVERDICT: the Standards screen ${followed ? "FOLLOWS" : "DOES NOT FOLLOW"} the class switch.`);
await page.screenshot({ path: join(OUT, "shot-standards.png") });
await browser.close();
