// The writing trait grid (Michael, 11 Nov 2026, "option A") at 390x844 and
// 1366x768: on a writing test's Class analysis tab, rubric traits down the
// side and score levels 1–4 across, each box the count of students at that
// level, coloured by level. Tapping a box lists those students and offers
// "Reteach this trait", which opens the lesson planner carrying only the trait
// name, level and counts (no student names). Demo data; /api/* mocked.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const CHROMIUM = process.env.CHROMIUM || "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const pass = [];
const fail = [];
const check = (c, m) => (c ? pass : fail).push(m);

const resp = (studentId, questionId, rubricScore) => ({
  id: studentId + questionId, studentId, questionId, answer: "", correct: rubricScore >= 4,
  misconception: "", confidence: 100, verified: true, rubricScore,
  match: Math.round((rubricScore / 4) * 100),
});

const browser = await chromium.launch({ executablePath: CHROMIUM });
for (const [W, H] of [[390, 844], [1366, 768]]) {
  const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
  w.classes = w.classes.map((c) => ({ ...c, demo: false, gradingMode: "percentage" }));
  const cls = w.classes[0];
  const roster = w.students.filter((s) => s.classId === cls.id).slice(0, 5);
  // Five students: on "Answer" 3 scored level 2 and 2 scored level 4; on
  // "Cite Evidence" 2 scored level 3.
  const writing = {
    id: "writing-demo", classId: cls.id, title: "Opinion essay", subject: "ELA", elaArea: "writing",
    grade: cls.grade, framework: cls.framework, createdAt: "2026-11-11T00:00:00Z", status: "Ready",
    uploadIds: [], source: "manual", targetStandards: [], questions: [],
    rubric: [
      { id: "t1", name: "Answer", max: 4, descriptor: "States a clear claim", standard: "W.4.1" },
      { id: "t2", name: "Cite Evidence", max: 4, descriptor: "Uses text evidence", standard: "RI.4.1" },
    ],
    responses: [
      resp(roster[0].id, "t1", 4), resp(roster[1].id, "t1", 2), resp(roster[2].id, "t1", 2),
      resp(roster[3].id, "t1", 2), resp(roster[4].id, "t1", 4),
      resp(roster[0].id, "t2", 3), resp(roster[1].id, "t2", 3),
    ],
  };
  w.assessments = [writing, ...w.assessments];

  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route("**/api/workspace", (r) =>
    r.request().method() === "GET"
      ? r.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }))
      : r.fulfill(json({ revision: 8 })),
  );
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 5000, used: 5, remaining: 4995, can_scan: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));

  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  try {
    await page.goto(`${BASE}/assessments?id=writing-demo&tab=analysis`, { waitUntil: "networkidle" });
    const grid = page.locator(".writing-trait-grid-panel");
    check(await grid.isVisible(), `${W}x${H}: the writing trait grid shows on the analysis tab`);
    check(/How many students reached each level/.test(await grid.innerText()), `${W}x${H}: it is labelled`);

    // The "Answer" trait: level 2 box reads 3, level 4 box reads 2.
    const lvl2 = page.getByRole("button", { name: /Answer, level 2 of 4: 3 students/ });
    const lvl4 = page.getByRole("button", { name: /Answer, level 4 of 4: 2 students/ });
    check(await lvl2.isVisible(), `${W}x${H}: Answer level 2 box counts 3 students`);
    check(await lvl4.isVisible(), `${W}x${H}: Answer level 4 box counts 2 students`);
    // Coloured differently (level 2 vs level 4 get different tone classes).
    const cls2 = await lvl2.getAttribute("class");
    const cls4 = await lvl4.getAttribute("class");
    check(cls2 !== cls4 && /level-/.test(cls2) && /level-/.test(cls4), `${W}x${H}: boxes are coloured by level`);

    // Tap the level-2 box: its students, and Reteach this trait.
    await lvl2.click();
    const panel = page.locator(".dok-cell-panel").last();
    await panel.getByText("Students at this level").waitFor({ timeout: 8000 });
    const names = roster.slice(1, 4).map((s) => s.name); // the three at level 2
    const panelText = await panel.innerText();
    check(names.every((n) => panelText.includes(n)), `${W}x${H}: the panel lists the three students at level 2`);
    const reteach = panel.getByRole("button", { name: "Reteach this trait" });
    check(await reteach.isVisible(), `${W}x${H}: a Reteach this trait action`);

    // Reteach → lesson planner with trait name/level/counts, no student names.
    await reteach.click();
    await page.waitForURL(/\/lessons\?/, { timeout: 8000 });
    const url = page.url();
    check(/[?&]trait=Answer/.test(url), `${W}x${H}: the planner URL carries the trait name`);
    check(/[?&]traitLevel=2/.test(url) && /[?&]traitMax=4/.test(url), `${W}x${H}: and the level and max`);
    check(/[?&]traitCounts=0%2C3%2C0%2C2/.test(url) || /[?&]traitCounts=0,3,0,2/.test(url), `${W}x${H}: and the per-level counts`);
    check(!names.some((n) => url.includes(encodeURIComponent(n)) || url.includes(n)), `${W}x${H}: no student name in the reteach URL`);
    const banner = page.locator(".reteach-context").first();
    await banner.waitFor({ timeout: 8000 });
    check(/Writing trait · Answer · level 2 of 4/.test(await banner.innerText()), `${W}x${H}: the planner shows the trait reteach banner`);

    check(errors.length === 0, `${W}x${H}: no page errors ${errors.join(" | ")}`);
    await page.screenshot({ path: join(OUT, `writing-trait-grid-${W}.png`) });
  } catch (e) {
    fail.push(`${W}x${H}: stopped -- ${String(e.message || e).split("\n")[0]} ${errors.join(" | ")}`);
    await page.screenshot({ path: join(OUT, `writing-trait-grid-FAILED-${W}.png`) });
  }
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
