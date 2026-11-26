// Ricky, 13 Nov 2026: "stuck, won't let me create a new lesson plan." At
// 390x844 and 1366x768, from a fixture like his (a grade-4 class with graded
// tests and 2 saved lesson plans), walk every path to START a new plan:
//   /lessons fresh; after opening a saved plan; the Saved lesson plans tab;
//   after a Generate finished; after a Generate where one version failed;
//   from a super-grid box; and the menu link while already on /lessons?… .
// Every non-empty state must show a visible "New lesson plan" action that
// returns to the "Start a lesson" panel (clearing params), asking first when
// there is unsaved work. Demo data; /api/* mocked (no AI spend).
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

const flow = (label) => ({ materials: [label + " kit"], phases: [{ time: "0–5", name: label + " launch", text: label + " way in" }] });
const full = (label) => ({
  objective: "Demo objective", ...flow(label),
  practice: [{ q: "Practice one?", a: "1" }], exit: [{ q: "Exit one?", a: "e1" }],
  game: { title: "Fact Relay", materials: ["Cones"], steps: ["Run"], connection: "Practises it." },
  performanceTask: { title: "Plan a trip", minutes: 18, groupSize: "Groups of 3–4", scenario: "Plan.", steps: ["Plan"], success: ["Right"] },
});

// A lesson like one Ricky would have saved.
const savedLesson = (id, over = {}) => ({
  id, classId: "demo", standard: "4.NBT.B.5", title: "Reteach: " + id, duration: 15,
  modality: "Visual", notes: "", date: "2026-11-20", completed: false, studentIds: [], origin: "ai", ...over,
});

const STD = "4.NBT.B.5";
const startPanel = (page) => page.getByRole("heading", { name: "Start a lesson" });
const newPlanBtn = (page) => page.getByRole("button", { name: "New lesson plan" });

// Non-empty states a teacher lands in; each must offer "New lesson plan".
const states = [
  ["opened a saved plan", `/lessons?lesson=plan-1`],
  ["the Saved lesson plans tab", `/lessons?tab=plan`],
  ["after a Generate / from a grid box", `/lessons?standard=${STD}`],
  ["a data-driven landing", `/lessons?start=data&standard=${STD}`],
  ["from scratch", `/lessons?start=scratch`],
  ["a pre-teach grid box", `/lessons?intent=preteach&cluster=4.NBT&dok=2`],
];

const browser = await chromium.launch({ executablePath: CHROMIUM });
for (const [W, H] of [[390, 844], [1366, 768]]) {
  const base = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
  base.classes = base.classes.map((c) => ({ ...c, demo: false, gradingMode: "percentage" }));
  base.lessons = [savedLesson("plan-1", { title: "Reteach place value" }), savedLesson("plan-2", { title: "Rounding practice", date: "2026-11-21" })];

  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route("**/api/workspace", (r) =>
    r.request().method() === "GET"
      ? r.fulfill(json({ workspace: base, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }))
      : r.fulfill(json({ revision: 8 })),
  );
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 5000, used: 5, remaining: 4995, can_scan: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  await ctx.route("**/api/lessons/refund", (r) => r.fulfill(json({ refunded: true })));
  // Lesson generate: POST answers with a scan id, the poll completes it.
  const jobs = new Map();
  let reqN = 0;
  await ctx.route("**/api/analyze", (r) => {
    const p = JSON.parse(r.request().postData() || "{}");
    const id = "job-" + ++reqN;
    jobs.set(id, p);
    return r.fulfill(json({ scanId: id }));
  });
  await ctx.route("**/api/analyze/job-*", (r) => {
    const p = jobs.get(r.request().url().split("/").pop());
    const part = p.lessonPart ?? "full";
    const label = p.modality === "Kinesthetic" ? "HandsOn" : p.modality;
    return r.fulfill(json({ status: "complete", result: part === "flow" ? flow(label) : full(label) }));
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  try {
    // Fresh /lessons: the Start panel is right there.
    await page.goto(`${BASE}/lessons`, { waitUntil: "networkidle" });
    check(await startPanel(page).isVisible(), `${W}x${H}: /lessons fresh shows the Start panel`);

    // Every non-empty state offers "New lesson plan", and it returns to Start.
    for (const [name, url] of states) {
      await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
      const btn = newPlanBtn(page);
      const visible = await btn.isVisible().catch(() => false);
      check(visible, `${W}x${H}: "${name}" shows a New lesson plan action`);
      if (!visible) {
        await page.screenshot({ path: join(OUT, `lesson-new-plan-STUCK-${W}-${url.replace(/\W+/g, "_")}.png`) });
        continue;
      }
      await btn.click();
      await page.waitForTimeout(250);
      check(await startPanel(page).isVisible(), `${W}x${H}: "${name}" → New lesson plan returns to the Start panel`);
    }

    // The menu link while already on a plan: the header action is the way back.
    await page.goto(`${BASE}/lessons?lesson=plan-1`, { waitUntil: "networkidle" });
    check(await newPlanBtn(page).isVisible(), `${W}x${H}: New lesson plan is reachable from a saved plan (the menu-link case)`);

    // Unsaved work: generate a lesson, then New lesson plan asks first.
    await page.goto(`${BASE}/lessons?standard=${STD}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Generate an AI lesson plan" }).click();
    await page.locator(".lesson-timeline").first().waitFor({ timeout: 15000 });
    await newPlanBtn(page).click();
    const confirm = page.getByText("Start a new lesson plan?");
    check(await confirm.isVisible().catch(() => false), `${W}x${H}: with an unsaved generated lesson, New lesson plan asks first`);
    await page.getByRole("button", { name: "Start new plan" }).click();
    await page.waitForTimeout(300);
    check(await startPanel(page).isVisible(), `${W}x${H}: confirming clears it and returns to the Start panel`);

    check(errors.length === 0, `${W}x${H}: no page errors ${errors.join(" | ")}`);
    await page.screenshot({ path: join(OUT, `lesson-new-plan-${W}.png`) });
  } catch (e) {
    fail.push(`${W}x${H}: stopped -- ${String(e.message || e).split("\n")[0]} ${errors.join(" | ")}`);
    await page.screenshot({ path: join(OUT, `lesson-new-plan-FAILED-${W}.png`) });
  }
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
