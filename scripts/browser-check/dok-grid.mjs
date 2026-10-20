// The class DOK grid (docs/design/grading-modes-and-dok-grid.md 2.1-2.3 and
// 2.7, D1), in a browser at 390x844, 412x915 and 1366x768.
//
// Proven when, on Class analysis: the grid has one row per standard card and
// four DOK cells per row; every scored cell is in the colour of its level
// (the rounded score) and shows that level's recommendation; a cell with no
// questions is grey and says "No questions"; the legend shows the four levels
// and "No questions"; a question with no DOK is named in a note, not counted;
// the old one-line-per-DOK rows are gone and Costa's levels stay; and on a
// phone each standard is a card with its four cells side by side in one row,
// nothing clipped and nothing scrolling sideways.
// Seeded demo data with made-up questions; /api/* is mocked.
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const SHOTS = process.env.SHOTS || join(OUT, "dok-grid");
const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const CHROMIUM = process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const pass = [];
const fail = [];
const check = (c, m) => (c ? pass : fail).push(m);
mkdirSync(SHOTS, { recursive: true });

const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
w.classes = w.classes.map((c) => ({ ...c, demo: false }));
const math = w.assessments.find((a) => a.id === "math-demo");
math.questions[5].dok = 3; // a second DOK on 4.NBT.B.5
math.questions[1].dok = null; // a question with no DOK
const LEVEL = (p) => (p >= 90 ? ["green", "Extension Recommended"] : p >= 80 ? ["blue", "Ready to Move On"] : p >= 70 ? ["yellow", "Monitor"] : ["red", "Reteach Recommended"]);

const browser = await chromium.launch({ executablePath: CHROMIUM });
for (const [W, H] of [[390, 844], [412, 915], [1366, 768]]) {
  const tag = `${W}x${H}`;
  const phone = W < 700;
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route("**/api/workspace", (r) =>
    r.request().method() === "GET"
      ? r.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }))
      : r.fulfill(json({ revision: 8 })),
  );
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  await ctx.route("**/api/scans/session**", (r) => r.fulfill(json({ state: null, revision: 0 })));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/assessments?id=math-demo&tab=analysis`, { waitUntil: "networkidle" });
  await page.waitForSelector(".dok-grid", { timeout: 15000 });

  const g = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".dok-grid-row")].map((row) => ({
      code: row.querySelector(".dok-grid-standard strong").textContent.trim(),
      cells: [...row.querySelectorAll(".dok-cell")].map((c) => ({
        cls: c.className,
        score: c.querySelector("strong")?.textContent.trim() ?? null,
        advice: c.querySelector(".dok-cell-advice")?.textContent.trim() ?? null,
        text: c.innerText.replace(/\s+/g, " ").trim(),
        top: Math.round(c.getBoundingClientRect().top),
        clipped: c.scrollWidth > c.clientWidth + 1 || c.scrollHeight > c.clientHeight + 1,
      })),
    }));
    return {
      rows,
      cards: document.querySelectorAll(".skill-gap-groups .student-group-card").length,
      head: getComputedStyle(document.querySelector(".dok-grid-head")).display,
      legend: [...document.querySelectorAll(".dok-grid-legend span")].map((s) => s.textContent.trim()),
      note: document.querySelector(".dok-grid-note")?.textContent.replace(/\s+/g, " ").trim() ?? "",
      main: document.querySelector("main").innerText,
      sideScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  check(g.rows.length > 0 && g.rows.length === g.cards, `${tag}: one grid row per standard card (${g.rows.length} rows, ${g.cards} cards)`);
  check(g.rows.every((r) => r.cells.length === 4), `${tag}: four DOK cells in every row`);
  const scored = g.rows.flatMap((r) => r.cells.filter((c) => c.score));
  const wrong = scored.filter((c) => {
    const [tone, advice] = LEVEL(parseInt(c.score, 10));
    return !c.cls.includes("level-" + tone) || c.advice !== advice;
  });
  check(scored.length > 0 && wrong.length === 0, `${tag}: ${scored.length} scored cells, each in its level's colour with its recommendation${wrong.length ? " -- wrong: " + JSON.stringify(wrong) : ""}`);
  const empty = g.rows.flatMap((r) => r.cells.filter((c) => !c.score));
  check(empty.length > 0 && empty.every((c) => c.cls.includes("level-none") && /No questions|Not graded yet/.test(c.text)), `${tag}: ${empty.length} cells without a score are grey and say why`);
  const nbt = g.rows.find((r) => r.code === "4.NBT.B.5");
  check(!!nbt && !!nbt.cells[1].score && !!nbt.cells[2].score && /No questions/.test(nbt.cells[0].text), `${tag}: 4.NBT.B.5 has DOK 2 and DOK 3 scores and no DOK 1 questions`);
  check(JSON.stringify(g.legend) === JSON.stringify(["Beginning 0–69%", "Approaching 70–79%", "Proficient 80–89%", "Exceeding 90–100%", "No questions"]), `${tag}: legend (${g.legend.join(" | ")})`);
  check(/1 question has no DOK level and is not in the grid/.test(g.note), `${tag}: the no-DOK note (${g.note})`);
  check(!/Depth of knowledge across this assessment/.test(g.main) && /Costa's levels across this assessment/.test(g.main), `${tag}: the DOK rows are replaced; Costa's levels stay`);
  check(!g.sideScroll, `${tag}: no sideways scroll`);
  check(g.rows.every((r) => r.cells.every((c) => !c.clipped)), `${tag}: nothing clipped in any cell`);
  // No word is broken across lines ("Recommend / ed"): every word of a
  // recommendation fits its cell's width.
  const broken = await page.$$eval(".dok-cell-advice", (els) =>
    els.filter((e) => {
      const range = document.createRange();
      return e.textContent.split(" ").some((word, i, words) => {
        const start = words.slice(0, i).join(" ").length + (i ? 1 : 0);
        range.setStart(e.firstChild, start);
        range.setEnd(e.firstChild, start + word.length);
        return range.getClientRects().length > 1;
      });
    }).map((e) => e.textContent),
  );
  check(broken.length === 0, `${tag}: no recommendation word is split across lines${broken.length ? " -- " + broken.join(", ") : ""}`);
  if (phone) {
    check(g.head === "none", `${tag}: phone: no header row; each cell names its DOK`);
    check(g.rows.every((r) => new Set(r.cells.map((c) => c.top)).size === 1), `${tag}: phone: each standard's four cells sit in one row`);
    check(g.rows.every((r) => r.cells.every((c) => /^DOK \d/.test(c.text))), `${tag}: phone: every cell says its DOK`);
  } else {
    check(g.head !== "none", `${tag}: computer: one header row of DOK 1–4`);
  }
  await page.locator(".dok-grid-panel").screenshot({ path: join(SHOTS, `grid-${tag}.png`) });
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
