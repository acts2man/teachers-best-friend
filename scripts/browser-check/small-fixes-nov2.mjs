// Small fixes (2 Nov 2026), in a browser at 390x844 and 1366x768:
//   (d) a lesson plan saves with no student selected, and the saved plan
//       says "Whole class";
//   (b) on a pre-teach lesson, picking another Focus skill drops the
//       pre-teach banner, and the lesson request is an ordinary one.
// Demo data; /api/* mocked (no AI spend).
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
const day = (ago) => {
  const d = new Date(Date.now() - ago * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const browser = await chromium.launch({ executablePath: CHROMIUM });
for (const [W, H] of [[390, 844], [1366, 768]]) {
  const tag = `${W}x${H}`;
  let current = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
  current.classes = current.classes.map((c) => ({ ...c, demo: false, gradingMode: "percentage" }));
  current.lessons = [];
  current.assessments.find((a) => a.id === "math-demo").dateGiven = day(7);
  current.assessments.find((a) => a.id === "ela-demo").dateGiven = day(40);
  let lessonRequest = null;
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route("**/api/workspace", (r) => {
    if (r.request().method() === "GET") return r.fulfill(json({ workspace: current, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }));
    current = JSON.parse(r.request().postData()).workspace;
    return r.fulfill(json({ revision: 8 }));
  });
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  await ctx.route("**/api/analyze", (r) => {
    lessonRequest = JSON.parse(r.request().postData() || "{}");
    return r.fulfill(json({ model: "mock", result: { objective: "Demo", materials: ["Paper"], phases: [{ time: "5 min", name: "Model", text: "Demo" }], practice: [{ q: "Demo", a: "1" }], exit: [{ q: "Demo", a: "1" }] } }));
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  try {
    // (d) No student chosen: Save works.
    await page.goto(`${BASE}/lessons?standard=4.OA.A.3`, { waitUntil: "networkidle" });
    const save = page.getByRole("button", { name: "Save to lesson plans" }).first();
    await save.waitFor({ timeout: 15000 });
    check(await save.isEnabled(), `${tag}: (d) Save is open with no student chosen`);
    await save.click();
    await page.waitForTimeout(1000);
    const saved = current.lessons[0];
    check(!!saved && saved.studentIds.length === 0, `${tag}: (d) it saved, for nobody in particular (${saved ? saved.studentIds.length : "none"})`);
    const planText = await page.locator("main").innerText();
    check(/Whole class/.test(planText), `${tag}: (d) the saved plan says "Whole class"`);

    // (b) A pre-teach lesson, then another Focus skill.
    await page.goto(`${BASE}/lessons`, { waitUntil: "networkidle" });
    await page.locator(".class-super-grid .dok-grid-row", { hasText: "4.OA" }).locator(".dok-cell").nth(1).click();
    await page.locator(".super-grid-panel").getByRole("button", { name: "Plan a pre-teach lesson" }).click();
    await page.locator(".preteach-context").waitFor({ timeout: 10000 });
    await page.getByRole("combobox", { name: "Reteach standard" }).click();
    const other = page.getByRole("option").filter({ hasNotText: /^$/ }).nth(1);
    await other.click();
    await page.waitForTimeout(500);
    check((await page.locator(".preteach-context").count()) === 0, `${tag}: (b) another Focus skill drops the pre-teach banner`);
    check(!/Build a pre-teach lesson/.test(await page.locator(".page-tabs").innerText()), `${tag}: (b) and the tab is an ordinary lesson again`);
    await page.getByRole("button", { name: "Generate an AI lesson plan" }).click();
    for (let t = 0; t < 100 && !lessonRequest; t++) await page.waitForTimeout(100);
    check(lessonRequest && lessonRequest.intent !== "preteach" && !lessonRequest.cluster && !lessonRequest.alsoStandards && !lessonRequest.errorTypes,
      `${tag}: (b) the request carries no pre-teach focus (${JSON.stringify({ intent: lessonRequest?.intent, cluster: lessonRequest?.cluster, errorTypes: lessonRequest?.errorTypes })})`);
    check(errors.length === 0, `${tag}: no page errors ${errors.join(" | ")}`);
  } catch (e) {
    fail.push(`${tag}: stopped -- ${String(e.message || e).split("\n")[0]}`);
    await page.screenshot({ path: join(OUT, `small-fixes-nov2-FAILED-${W}.png`) });
  }
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
