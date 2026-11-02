// Super grid step 2, in a browser at 390x844 and 1366x768: a super-grid
// cell's "Plan a pre-teach lesson" opens the lesson builder for the cell's
// weakest standard with a pre-teach banner, and the lesson request it sends
// is only { cluster, dok, standard + up to two more codes, error-type names
// with counts } on top of an ordinary lesson request -- no student name,
// answer, or typed Other label. Demo data; /api/* mocked (no AI spend).
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
  const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
  w.classes = w.classes.map((c) => ({ ...c, demo: false, gradingMode: "percentage" }));
  const math = w.assessments.find((a) => a.id === "math-demo");
  math.dateGiven = day(7);
  w.assessments.find((a) => a.id === "ela-demo").dateGiven = day(40);
  // Tag wrong answers on 4.OA at DOK 2: two of the list's names and a typed Other.
  const oa = new Set(math.questions.filter((q) => q.standard.startsWith("4.OA") && q.dok === 2).map((q) => q.id));
  const wrong = math.responses.filter((r) => r.verified && !r.correct && oa.has(r.questionId));
  wrong.slice(0, 3).forEach((r) => (r.errorType = "Sign Error"));
  wrong.slice(3, 4).forEach((r) => (r.errorType = "Other: forgot to carry"));
  const names = w.students.map((s) => s.name);
  const answers = math.responses.map((r) => r.finalAnswer || r.answer).filter((x) => x && x.length > 2);
  let lessonRequest = null;
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route("**/api/workspace", (r) =>
    r.request().method() === "GET"
      ? r.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }))
      : r.fulfill(json({ revision: 8 })),
  );
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  await ctx.route("**/api/analyze", (r) => {
    lessonRequest = JSON.parse(r.request().postData() || "{}");
    return r.fulfill(json({ model: "mock", result: {
      objective: "Demo objective", materials: ["Paper"], phases: [{ time: "5 min", name: "Model", text: "Demo" }],
      practice: [{ q: "Demo problem", a: "1" }], exit: [{ q: "Demo exit", a: "1" }],
    } }));
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  const sideScroll = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  try {
    await page.goto(`${BASE}/lessons`, { waitUntil: "networkidle" });
    const grid = page.locator(".class-super-grid");
    await grid.waitFor({ timeout: 15000 });
    await grid.locator(".dok-grid-row", { hasText: "4.OA" }).locator(".dok-cell").nth(1).click();
    const panel = page.locator(".super-grid-panel");
    await panel.waitFor({ timeout: 10000 });
    const button = panel.getByRole("button", { name: "Plan a pre-teach lesson" });
    check((await button.count()) === 1, `${tag}: the cell's panel has "Plan a pre-teach lesson"`);
    const note = (await panel.innerText()).replace(/\s+/g, " ");
    check(/never a student.s name or answer/.test(note), `${tag}: and says what is sent`);
    check(!(await sideScroll()), `${tag}: the panel fits`);
    await button.click();
    const banner = page.locator(".preteach-context");
    await banner.waitFor({ timeout: 10000 });
    const said = (await banner.innerText()).replace(/\s+/g, " ");
    check(/Pre-teach · Operations & Algebraic Thinking · 4\.OA · DOK 2/.test(said), `${tag}: the lesson builder opens on the pre-teach ("${said.slice(0, 90)}")`);
    check(/Aimed at: Sign Error \(3\), Other \(1\)/.test(said), `${tag}: aimed at the cell's errors, a typed label only as Other ("${(said.match(/Aimed at:[^.]*/) || [""])[0]}")`);
    check(/Build a pre-teach lesson/.test(await page.locator(".page-tabs").innerText()), `${tag}: the tab says pre-teach`);
    check(!(await sideScroll()), `${tag}: the builder fits`);
    await page.getByRole("button", { name: "Generate an AI lesson plan" }).click();
    for (let t = 0; t < 100 && !lessonRequest; t++) await page.waitForTimeout(100);
    const body = JSON.stringify(lessonRequest ?? {});
    check(lessonRequest?.mode === "lesson" && lessonRequest.intent === "preteach" && lessonRequest.cluster === "4.OA", `${tag}: a lesson request, intent preteach, cluster 4.OA`);
    check(JSON.stringify(lessonRequest?.dok) === "[2]", `${tag}: DOK [2]`);
    check(/^4\.OA/.test(lessonRequest?.standard || "") && (lessonRequest?.alsoStandards || []).every((c) => /^4\.OA/.test(c)), `${tag}: the cluster's weakest standard codes (${lessonRequest?.standard}; ${JSON.stringify(lessonRequest?.alsoStandards)})`);
    check(JSON.stringify(lessonRequest?.errorTypes) === JSON.stringify([{ name: "Sign Error", count: 3 }, { name: "Other", count: 1 }]), `${tag}: error-type names with counts (${JSON.stringify(lessonRequest?.errorTypes)})`);
    const allowed = ["mode", "standard", "duration", "modality", "text", "framework", "grade", "intent", "cluster", "alsoStandards", "dok", "errorTypes"];
    check(Object.keys(lessonRequest ?? {}).every((k) => allowed.includes(k)), `${tag}: nothing else in it (${Object.keys(lessonRequest ?? {}).join(", ")})`);
    check(!names.some((n) => body.includes(n)) && !answers.some((a) => body.includes(JSON.stringify(a))) && !body.includes("forgot to carry"), `${tag}: no student name, no answer, no typed label`);
    check(errors.length === 0, `${tag}: no page errors ${errors.join(" | ")}`);
  } catch (e) {
    fail.push(`${tag}: stopped -- ${String(e.message || e).split("\n")[0]}`);
    await page.screenshot({ path: join(OUT, `preteach-FAILED-${W}.png`) });
  }
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
