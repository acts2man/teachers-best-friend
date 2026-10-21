// The grading mode (G1, then Ricky's change of 20 Oct 2026), in a browser at
// 390x844 and 1366x768.
//
// Proven when: a test's page shows its mode ("Percentage" or
// "Standards-Based (0–4)") with no way to switch it; on a Standards-Based test
// every question's points read a locked 4 (no points editor), the total says
// it can't be changed, the "coming next" note is shown, and the Edit dialog
// has no total -- renaming saves the name and nothing else; a Percentage test
// keeps its points editor; the setup screen for a NEW test offers the choice,
// starts in the mode used last and says it is final; editing an existing test
// in setup shows its mode without a choice. (Hiding "Points possible" for a
// Standards-Based test is on setup's second step; tests/sbg-setup-only.) Nothing scrolls sideways. Seeded demo data; /api/* is mocked and
// every save is captured.
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const SHOTS = process.env.SHOTS || join(OUT, "grading-mode");
const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const CHROMIUM = process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const pass = [];
const fail = [];
const check = (c, m) => (c ? pass : fail).push(m);
mkdirSync(SHOTS, { recursive: true });

const original = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
original.classes = original.classes.map((c) => ({ ...c, demo: false }));
const SBG = "math-demo"; // made Standards-Based, its questions carrying old points
const PCT = "ela-demo";
const sbgTest = original.assessments.find((a) => a.id === SBG);
sbgTest.gradingMode = "sbg";
sbgTest.questions.forEach((q, i) => (q.points = i === 0 ? 6 : 1));
original.settings.lastGradingMode = "sbg";

const browser = await chromium.launch({ executablePath: CHROMIUM });
for (const [W, H] of [[390, 844], [1366, 768]]) {
  const tag = `${W}x${H}`;
  let saved = null;
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route("**/api/workspace", (r) => {
    if (r.request().method() === "GET")
      return r.fulfill(json({ workspace: original, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }));
    saved = JSON.parse(r.request().postData() || "{}").workspace;
    return r.fulfill(json({ revision: 8 }));
  });
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  await ctx.route("**/api/scans/session**", (r) => r.fulfill(json({ state: null, revision: 0 })));
  const page = await ctx.newPage();
  const noSideScroll = async (where) =>
    check(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), `${tag} ${where}: no sideways scroll`);

  // Standards-Based test.
  await page.goto(`${BASE}/assessments?id=${SBG}&tab=questions`, { waitUntil: "networkidle" });
  await page.waitForSelector(".grading-mode-row", { timeout: 15000 });
  const row = (await page.locator(".grading-mode-row").innerText()).replace(/\s+/g, " ");
  check(/Standards-Based \(0–4\)/.test(row) && /Scoring out of 4 is coming next/.test(row), `${tag} SBG test: shows its mode and the coming-next note (${row})`);
  check((await page.locator(".grading-mode-row button").count()) === 0, `${tag} SBG test: no switch on the test page`);
  const locked = await page.locator(".locked-points").allInnerTexts();
  const active = sbgTest.questions.filter((q) => !q.excluded).length;
  check(locked.length === active && locked.every((t) => t.trim() === "4"), `${tag} SBG test: every question reads a locked 4 (${locked.join(",")})`);
  check((await page.locator('td[data-label="Points"] input').count()) === 0, `${tag} SBG test: no points editor`);
  const total = (await page.locator(".points-total").innerText()).replace(/\s+/g, " ");
  check(new RegExp(`Total: ${active * 4} points`).test(total) && /can't be changed/.test(total), `${tag} SBG test: total is ${active} × 4 and locked (${total})`);
  await page.locator(".grading-mode-row").screenshot({ path: join(SHOTS, `sbg-row-${tag}.png`) });
  await noSideScroll("SBG test");

  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Edit assessment" });
  await dialog.waitFor();
  check((await dialog.locator('input[type="number"]').count()) === 0, `${tag} SBG Edit dialog: no total to set`);
  check(/every question is worth 4 points/.test(await dialog.innerText()), `${tag} SBG Edit dialog: says every question is worth 4`);
  await dialog.locator("input").first().fill("Renamed SBG quiz");
  await dialog.getByRole("button", { name: "Save assessment" }).click();
  await dialog.waitFor({ state: "hidden", timeout: 10000 });
  const after = saved?.assessments.find((a) => a.id === SBG);
  check(
    after?.title === "Renamed SBG quiz" && after.gradingMode === "sbg" && JSON.stringify(after.questions) === JSON.stringify(sbgTest.questions) && after.pointsPossible === sbgTest.pointsPossible,
    `${tag} SBG rename: only the name changed`,
  );

  // Percentage test keeps its editor.
  await page.goto(`${BASE}/assessments?id=${PCT}&tab=questions`, { waitUntil: "networkidle" });
  await page.waitForSelector(".grading-mode-row");
  const pctRow = (await page.locator(".grading-mode-row").innerText()).replace(/\s+/g, " ");
  check(/Percentage/.test(pctRow) && !/coming next/.test(pctRow) && (await page.locator(".grading-mode-row button").count()) === 0, `${tag} Percentage test: shows its mode, no switch (${pctRow})`);
  check((await page.locator(".locked-points").count()) === 0 && (await page.locator('td[data-label="Points"] input').count()) > 0, `${tag} Percentage test: points stay editable`);

  // New test: the choice, starting in the last mode; no total for SBG.
  await page.goto(`${BASE}/scan`, { waitUntil: "networkidle" });
  const setup = page.locator(".grading-mode-setup");
  await setup.waitFor({ timeout: 15000 });
  const pressed = (await setup.locator("button[aria-pressed=true]").innerText()).trim();
  check(pressed === "Standards-Based (0–4)", `${tag} new test: offers the choice, starting in the last mode (${pressed})`);
  check(/can't be changed once the test is created/.test(await setup.innerText()), `${tag} new test: says the choice is final`);
  await setup.screenshot({ path: join(SHOTS, `setup-new-${tag}.png`) });
  await noSideScroll("setup");

  // Editing an existing test in setup: its mode, no choice.
  await page.goto(`${BASE}/scan?assessment=${PCT}`, { waitUntil: "networkidle" });
  const edit = page.locator(".grading-mode-setup");
  await edit.waitFor({ timeout: 15000 });
  check((await edit.locator("button").count()) === 0 && /Percentage/.test(await edit.innerText()) && /Chosen when this test was created/.test(await edit.innerText()), `${tag} editing a test in setup: shows its mode, no choice`);
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
