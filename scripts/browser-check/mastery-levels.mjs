// Ricky's four mastery levels, in a browser at 390x844 and 1366x768.
//
// Proven when: every screen that showed mastery uses the four levels and the
// same cut-offs -- Developing 0–69% red, Approaching 70–79% yellow, Proficient
// 80–89% blue, Exceeding 90–100% green -- with no "Mastered" or "Mastery is
// 70%" left; every mastery percentage on screen is coloured by the level that
// number is in; reteach is offered for Developing and extension for
// Exceeding only; and nothing scrolls sideways.
// Seeded demo data only; /api/* is mocked.
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const SHOTS = process.env.SHOTS || join(OUT, "mastery-levels");
const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const CHROMIUM = process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const pass = [];
const fail = [];
const check = (c, m) => (c ? pass : fail).push(m);
mkdirSync(SHOTS, { recursive: true });

const LEVELS = [
  ["Developing", 0, "level-red"],
  ["Approaching", 70, "level-yellow"],
  ["Proficient", 80, "level-blue"],
  ["Exceeding", 90, "level-green"],
];
const classFor = (p) => LEVELS.filter(([, min]) => p >= min).pop()[2];
const OLD_WORDS = /\bMastered\b|Mastery is 70%|skills mastered|80%\+|Below 65%|65–79%|least 80%|High \/ Mid \/ Low/;

const fixture = () => {
  const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
  w.classes = w.classes.map((c) => ({ ...c, demo: false }));
  return w;
};

/** Every mastery percentage on the page, with the class it is coloured by. */
async function coloured(page) {
  return page.$$eval(".score[class*='level-'], .pill[class*='level-']", (els) =>
    els
      .filter((e) => e.offsetParent !== null)
      .map((e) => ({ text: e.textContent.trim(), cls: [...e.classList].find((c) => c.startsWith("level-")) })),
  );
}

const browser = await chromium.launch({ executablePath: CHROMIUM });
for (const [W, H] of [[390, 844], [1366, 768]]) {
  const tag = `${W}x${H}`;
  const w = fixture();
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
  const noSideScroll = async (where) =>
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${tag} ${where}: no horizontal scroll`);
  const percentsMatch = async (where) => {
    const items = (await coloured(page)).filter((x) => /^\d+%$/.test(x.text));
    const wrong = items.filter((x) => x.cls !== classFor(Number(x.text.replace("%", ""))));
    check(items.length > 0 && wrong.length === 0, `${tag} ${where}: ${items.length} mastery percentages, each in its level's colour${wrong.length ? " -- wrong: " + JSON.stringify(wrong.slice(0, 3)) : ""}`);
  };

  // 1. Class analysis on the demo math assessment.
  await page.goto(`${BASE}/assessments?id=math-demo&tab=analysis`, { waitUntil: "networkidle" });
  await page.waitForSelector(".skill-gap-groups", { timeout: 15000 });
  let body = await page.locator("main").innerText();
  check(!OLD_WORDS.test(body), `${tag} class analysis: no old mastery wording`);
  check(/Developing 0–69% \(reteach\), Approaching 70–79% \(targeted practice\), Proficient 80–89% \(optional reinforcement\), Exceeding 90–100% \(extension\)/.test(body), `${tag} class analysis: the four levels are stated`);
  check(/(Developing|Approaching|Proficient|Exceeding) · \d+–\d+% \(\d+\)/.test(body), `${tag} class analysis: students listed by level`);
  const pills = await page.$$eval(".skill-gap-groups .pill[class*='level-']", (els) => els.map((e) => e.textContent.trim()));
  check(pills.length > 0 && pills.every((t) => /^(Developing|Approaching|Proficient|Exceeding)$/.test(t)), `${tag} class analysis: each standard shows its level (${[...new Set(pills)].join(", ")})`);
  // Every level present has its next-step button, and no other (Ricky, 19 Oct).
  const cards = await page.$$eval(".skill-gap-groups .student-group-card", (els) =>
    els.map((e) => {
      const t = e.innerText;
      const has = (l) => new RegExp(l + " · \\d").test(t);
      return {
        levels: ["Developing", "Approaching", "Proficient", "Exceeding"].filter(has),
        buttons: [...e.querySelectorAll(".review-heading-actions button")].map((b) => b.innerText.trim()),
      };
    }),
  );
  const STEP = { Developing: "Reteach", Approaching: "Offer targeted practice", Proficient: "Offer optional reinforcement", Exceeding: "Offer extension activity" };
  const ok = cards.every((c) =>
    ["Developing", "Approaching", "Proficient", "Exceeding"].every(
      (l) => c.levels.includes(l) === c.buttons.some((b) => b.startsWith(STEP[l] + " · " + l)),
    ),
  );
  check(cards.length > 0 && ok, `${tag} class analysis: each level present has its next-step button and no other (${cards.map((c) => c.buttons.length).join(",")} buttons)`);
  // A next-step button opens the lesson generator with its level's intent:
  // whichever non-reteach step this class has (the demo class has none at
  // Approaching).
  const INTENT = { "Offer targeted practice": "practice", "Offer optional reinforcement": "reinforcement", "Offer extension activity": "extension" };
  let tried = false;
  for (const [label, intent] of Object.entries(INTENT)) {
    const btn = page.getByRole("button", { name: new RegExp(label + " · ") }).first();
    if (!(await btn.count())) continue;
    tried = true;
    await btn.click();
    await page.waitForURL(/\/lessons\?/, { timeout: 10000 });
    const url = page.url();
    const tab = (await page.locator("[role=tab]").first().innerText()).trim();
    check(new RegExp("intent=" + intent).test(url) && /students=/.test(url) && tab === label, `${tag} class analysis: "${label}" opens the lesson generator with intent=${intent} (tab: ${tab})`);
    await page.goto(`${BASE}/assessments?id=math-demo&tab=analysis`, { waitUntil: "networkidle" });
    await page.waitForSelector(".skill-gap-groups");
    break;
  }
  if (!tried) check(false, `${tag} class analysis: a non-reteach next step to try`);
  const clipped = await page.$$eval(".skill-gap-groups .student-group-card .review-heading-actions button", (els) =>
    els.filter((b) => b.scrollWidth > b.clientWidth + 1 || b.getBoundingClientRect().right > b.closest(".panel").getBoundingClientRect().right + 1).map((b) => b.innerText),
  );
  check(clipped.length === 0, `${tag} class analysis: no next-step button runs past its card${clipped.length ? " -- " + JSON.stringify(clipped) : ""}`);
  const red = await page.$eval(".skill-gap-groups .level-label.level-red, .skill-gap-groups .pill.level-red", (e) => getComputedStyle(e).color).catch(() => null);
  check(red === null || red === "rgb(163, 38, 31)", `${tag} class analysis: Developing is red (${red})`);
  await noSideScroll("class analysis");
  await page.screenshot({ path: join(SHOTS, `class-analysis-${tag}.png`), fullPage: true });

  // 2. The standards heatmap.
  await page.goto(`${BASE}/diagnostics`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Standards heatmap" }).click();
  await page.waitForSelector(".heatmap-legend");
  const legend = await page.$$eval(".heatmap-legend span", (els) => els.map((e) => [e.textContent.trim(), e.className]));
  check(
    JSON.stringify(legend) === JSON.stringify([["Developing 0–69%", "level-red"], ["Approaching 70–79%", "level-yellow"], ["Proficient 80–89%", "level-blue"], ["Exceeding 90–100%", "level-green"]]),
    `${tag} heatmap: legend is the four levels (${legend.map((l) => l[0]).join(" | ")})`,
  );
  body = await page.locator("main").innerText();
  check(!OLD_WORDS.test(body), `${tag} heatmap: no old mastery wording`);
  await percentsMatch("heatmap");
  await noSideScroll("heatmap");
  await page.screenshot({ path: join(SHOTS, `heatmap-${tag}.png`), fullPage: true });

  // 3. Students: the cards, then the Mastery levels view.
  await page.goto(`${BASE}/students`, { waitUntil: "networkidle" });
  await page.waitForSelector(".student-grid");
  body = await page.locator("main").innerText();
  check(!OLD_WORDS.test(body), `${tag} students: no old mastery wording`);
  check(/\d+\/\d+ skills at or above 70% standard score/.test(body), `${tag} students: cards count skills at or above 70% standard score`);
  const blocks = await page.$$eval(".mastery-blocks > span", (els) => els.map((e) => e.className));
  check(blocks.length > 0 && blocks.every((c) => /^level-(red|yellow|blue|green|none)$/.test(c)), `${tag} students: skill blocks use the level colours (${[...new Set(blocks)].join(", ")})`);
  await page.getByRole("button", { name: "Mastery levels" }).click();
  const bands = await page.$$eval(".student-groups-grid .student-group-card h2", (els) => els.map((e) => e.textContent.trim()));
  check(JSON.stringify(bands) === JSON.stringify(["Developing", "Approaching", "Proficient", "Exceeding", "No evidence yet"]), `${tag} mastery levels view: ${bands.join(", ")}`);
  await percentsMatch("mastery levels view");
  await noSideScroll("mastery levels view");
  await page.screenshot({ path: join(SHOTS, `levels-${tag}.png`), fullPage: true });

  // 4. One student.
  await page.goto(`${BASE}/students?id=${w.students[0].id}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".trajectory-panel");
  body = await page.locator("main").innerText();
  check(!OLD_WORDS.test(body), `${tag} student page: no old mastery wording`);
  const statuses = await page.$$eval(".mastery-status", (els) => els.map((e) => e.textContent.trim()));
  check(statuses.length > 0 && statuses.every((s) => /^(Developing|Approaching|Proficient|Exceeding|Building evidence|No evidence)$/.test(s)), `${tag} student page: statuses are levels (${[...new Set(statuses)].join(", ")})`);
  await percentsMatch("student page");
  await noSideScroll("student page");
  await page.screenshot({ path: join(SHOTS, `student-${tag}.png`), fullPage: true });
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
