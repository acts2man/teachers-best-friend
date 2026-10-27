// The class super grid, build step 1, in a browser at 390x844 and 1366x768.
// Proven when Lesson Planning opens on the grid (above the lesson builder):
// clusters down the side, DOK 1–4 across, every confirmed answer from this
// school year's tests; a tapped cell opens its panel with the score,
// questions in the last 30 days and before (by date given), the weakest
// standards and the common errors; a Standards-Based class reads 0–4; no AI
// request is made; and nothing scrolls sideways.
// Seeded demo data only; /api/* is mocked.
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
// The first name on this build's Math error list (lib/error-types.ts).
const TAG = /const MATH_ERROR_TYPES = \[\s*"([^"]+)"/.exec(readFileSync(join(HERE, "../../lib/error-types.ts"), "utf8"))[1];
const day = (ago) => {
  const d = new Date(Date.now() - ago * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function fixture(mode) {
  const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
  w.classes = w.classes.map((c) => ({ ...c, demo: false, gradingMode: mode }));
  const math = w.assessments.find((a) => a.id === "math-demo");
  const ela = w.assessments.find((a) => a.id === "ela-demo");
  math.dateGiven = day(7); // the last 30 days
  ela.dateGiven = day(40); // before
  // Tag a few wrong math answers so the panel has common errors to show.
  const [first] = math.responses.filter((r) => r.verified && !r.correct);
  const sameQ = math.responses.filter((r) => r.verified && !r.correct && r.questionId === first.questionId);
  sameQ.slice(0, 3).forEach((r) => (r.errorType = TAG));
  return { w, taggedQuestion: math.questions.find((q) => q.id === first.questionId) };
}

const browser = await chromium.launch({ executablePath: CHROMIUM });
for (const [W, H] of [[390, 844], [1366, 768]]) {
  for (const mode of ["percentage", "sbg"]) {
    const tag = `${W}x${H} ${mode}`;
    const { w, taggedQuestion } = fixture(mode);
    const ctx = await browser.newContext({ viewport: { width: W, height: H } });
    let ai = 0;
    await ctx.route("**/api/workspace", (r) =>
      r.request().method() === "GET"
        ? r.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }))
        : r.fulfill(json({ revision: 8 })),
    );
    await ctx.route("**/api/analyze**", (r) => {
      ai++;
      return r.fulfill(json({ error: "no AI in this check" }, 500));
    });
    await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
    await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
    const sideScroll = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    try {
      await page.goto(`${BASE}/lessons`, { waitUntil: "networkidle" });
      const grid = page.locator(".class-super-grid");
      await grid.waitFor({ timeout: 15000 });
      const above = await page.evaluate(() => {
        const g = document.querySelector(".class-super-grid");
        const tabs = document.querySelector(".page-tabs");
        return !!g && !!tabs && g.getBoundingClientRect().top < tabs.getBoundingClientRect().top;
      });
      check(above, `${tag}: Lesson Planning opens on the super grid, above the lesson builder`);
      const head = (await grid.locator(".super-grid-head").innerText()).replace(/\s+/g, " ");
      check(/2026–27 school year/.test(head) && /from 2 tests/.test(head), `${tag}: this school year, both tests ("${head.slice(0, 120)}")`);
      check(new RegExp(mode === "sbg" ? "Standards-Based" : "Percentage").test(head), `${tag}: in the class's grading mode`);
      const rows = (await grid.locator(".dok-grid-row .dok-grid-standard strong").allInnerTexts()).map((t) => t.trim());
      check(JSON.stringify([...rows].sort()) === JSON.stringify(["4.NBT", "4.OA", "RI", "RL"]), `${tag}: a row per cluster (${rows.join(", ")})`);
      check((await grid.locator(".dok-grid-row").first().locator(".dok-cell").count()) === 4, `${tag}: DOK 1–4 in each row`);
      check(!(await sideScroll()), `${tag}: nothing scrolls sideways`);
      await grid.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(OUT, `class-super-grid-${W}-${mode}.png`) });

      // Tap the cell holding the tagged answers.
      const cluster = taggedQuestion.standard.split(".").slice(0, 2).join(".");
      const cell = grid.locator(".dok-grid-row", { hasText: cluster }).locator(".dok-cell").nth(taggedQuestion.dok - 1);
      const cellText = (await cell.innerText()).replace(/\s+/g, " ");
      check(mode === "sbg" ? /\d\.\d/.test(cellText) : /\d+%/.test(cellText), `${tag}: the cell reads ${mode === "sbg" ? "0–4" : "percent"} ("${cellText}")`);
      await cell.click();
      const panel = page.locator(".super-grid-panel");
      await panel.waitFor({ timeout: 10000 });
      const text = (await panel.innerText()).replace(/\s+/g, " ");
      check(mode === "sbg" ? /\d\.\d out of 4/.test(text) : /\d+%/.test(text), `${tag}: the panel has the score`);
      check(/Questions asked this school year/.test(text) && /Last 30 days \d+/.test(text) && /More than 30 days ago 0/.test(text), `${tag}: questions in the last 30 days and before ("${(text.match(/In total.*?ago \d+/) || [""])[0]}")`);
      check(/Weakest standards/.test(text) && text.includes(taggedQuestion.standard), `${tag}: the weakest standards`);
      check(text.includes("Common errors " + TAG + " 3 answers"), `${tag}: the common errors (${TAG} × 3)`);
      check((await panel.getAttribute("data-side")) === (W < 768 ? "bottom" : "right"), `${tag}: a ${W < 768 ? "bottom" : "side"} sheet`);
      check(!(await sideScroll()), `${tag}: the panel fits`);
      await page.waitForTimeout(400);
      await panel.screenshot({ path: join(OUT, `class-super-grid-panel-${W}-${mode}.png`) });
      await page.keyboard.press("Escape");
      // An ELA cell from the test given 40 days ago counts as before.
      const ri = grid.locator(".dok-grid-row", { hasText: "RI" }).locator(".dok-cell").nth(1);
      await ri.click();
      const riText = (await page.locator(".super-grid-panel").innerText()).replace(/\s+/g, " ");
      check(/Last 30 days 0/.test(riText) && /More than 30 days ago [1-9]/.test(riText), `${tag}: a test given 40 days ago counts as before`);
      await page.keyboard.press("Escape");
      check(ai === 0, `${tag}: no AI request (${ai})`);
      check(errors.length === 0, `${tag}: no page errors ${errors.join(" | ")}`);
    } catch (e) {
      fail.push(`${tag}: stopped -- ${String(e.message || e).split("\n")[0]}`);
      await page.screenshot({ path: join(OUT, `class-super-grid-FAILED-${W}-${mode}.png`) });
    }
    await ctx.close();
  }
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
