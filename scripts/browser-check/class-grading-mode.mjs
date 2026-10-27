// Grading mode per class (Ricky, 27 Oct 2026), in a browser at 390x844 and
// 1366x768. Proven when: "Add class" asks for the mode and saves it; a new
// test in that class shows the class's mode with no choice; a class graded
// another way is not offered for sharing the test (and the teacher is told
// why); a class made before this reads as Standards-Based only when all its
// tests are; and editing a class shows its mode without a way to change it.
// Seeded demo data only; /api/* is mocked and every save is kept.
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
  // A class from before modes per class, whose only test is Standards-Based.
  w.classes.push({ id: "room-9", name: "Room 9", grade: 4, framework: w.classes[0].framework, demo: false });
  const copy = JSON.parse(JSON.stringify(w.assessments.find((a) => a.id === "math-demo")));
  w.assessments.push({ ...copy, id: "room-9-quiz", classId: "room-9", classIds: undefined, gradingMode: "sbg", responses: [] });
  return w;
}

const browser = await chromium.launch({ executablePath: CHROMIUM });
for (const [W, H] of [[390, 844], [1366, 768]]) {
  const tag = `${W}x${H}`;
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
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  const sideScroll = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  try {
    await page.goto(`${BASE}/classes`, { waitUntil: "networkidle" });
    const cards = (await page.locator(".class-card").allInnerTexts()).map((t) => t.replace(/\s+/g, " "));
    const room9 = cards.find((t) => t.includes("Room 9")) || "";
    const explorers = cards.find((t) => !t.includes("Room 9")) || "";
    check(/Standards-Based \(0–4\)/.test(room9), `${tag}: a class from before, all tests Standards-Based, reads Standards-Based ("${room9.slice(0, 80)}")`);
    check(/Percentage/.test(explorers), `${tag}: one with Percentage tests reads Percentage ("${explorers.slice(0, 80)}")`);

    await page.getByRole("button", { name: "Add class" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Class name").fill("Period 5");
    const choice = dialog.locator(".grading-mode-choice button");
    check((await choice.count()) === 2, `${tag}: Add class asks Percentage or Standards-Based (${await choice.count()} choices)`);
    check(!(await sideScroll()), `${tag}: the Add class form fits (no sideways scroll)`);
    await page.screenshot({ path: join(OUT, `class-grading-mode-add-${W}.png`) });
    await dialog.getByRole("button", { name: "Standards-Based (0–4)" }).click();
    await dialog.getByRole("button", { name: "Create class" }).click();
    await page.waitForTimeout(800);
    const made = current.classes.find((c) => c.name === "Period 5");
    check(made?.gradingMode === "sbg", `${tag}: the new class is saved Standards-Based (${made?.gradingMode})`);

    // A new test in Period 5 (now the open class): its mode, no choice.
    await page.goto(`${BASE}/scan`, { waitUntil: "networkidle" });
    const setup = page.locator(".grading-mode-setup").first();
    await setup.waitFor({ timeout: 10000 });
    const text = (await setup.innerText()).replace(/\s+/g, " ");
    check(/Standards-Based \(0–4\)/.test(text) && /Every new test in Period 5 is graded this way/.test(text), `${tag}: test setup shows the class's mode ("${text.slice(0, 120)}")`);
    check((await page.locator(".grading-mode-choice").count()) === 0, `${tag}: and offers no choice`);
    const link = page.locator(".link-classes");
    if (await link.count()) {
      const linkText = (await link.innerText()).replace(/\s+/g, " ");
      check(/Room 9/.test(linkText) && !/The Explorers/.test(linkText.replace(/1 other class.*/, "")), `${tag}: only a class graded the same way can share it ("${linkText.slice(0, 160)}")`);
      check(/1 other class is graded as a Percentage, so it can't share this test\./.test(linkText), `${tag}: and the teacher is told why the other is missing`);
    } else fail.push(`${tag}: no "Use this assessment in" list`);
    check(!(await sideScroll()), `${tag}: the setup fits (no sideways scroll)`);
    await page.screenshot({ path: join(OUT, `class-grading-mode-setup-${W}.png`), fullPage: false });

    // Back in The Explorers: Percentage.
    current = { ...current, activeClassId: current.classes.find((c) => c.name === "The Explorers").id };
    await page.goto(`${BASE}/scan`, { waitUntil: "networkidle" });
    const pct = (await page.locator(".grading-mode-setup").first().innerText()).replace(/\s+/g, " ");
    check(/Percentage/.test(pct) && /Every new test in The Explorers/.test(pct), `${tag}: a Percentage class's new test is Percentage ("${pct.slice(0, 100)}")`);

    // Editing a class shows its mode and cannot change it.
    await page.goto(`${BASE}/classes`, { waitUntil: "networkidle" });
    await page.locator(".class-card").filter({ hasText: "Period 5" }).getByRole("button", { name: /Edit/ }).first().click();
    const edit = page.getByRole("dialog");
    const editText = (await edit.innerText()).replace(/\s+/g, " ");
    check(/Standards-Based \(0–4\)/.test(editText) && /can't be changed/.test(editText) && (await edit.locator(".grading-mode-choice").count()) === 0, `${tag}: editing a class shows its mode, unchangeable`);
    check(errors.length === 0, `${tag}: no page errors ${errors.join(" | ")}`);
  } catch (e) {
    fail.push(`${tag}: stopped -- ${String(e.message || e).split("\n")[0]}`);
    await page.screenshot({ path: join(OUT, `class-grading-mode-FAILED-${W}.png`) });
  }
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
