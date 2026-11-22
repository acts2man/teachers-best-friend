// Review of #216, blocker 2 — a running Generate must not be abandoned for a
// spent credit. With a 5 s delayed model response, on `next build --webpack` +
// `next start`, this proves that while "Building your plan…":
//   (a) the Focus skill (standard) picker is disabled;
//   (b) Saved lesson plans → "Open lesson" is disabled and a note explains why;
//   (c) leaving the page (cross-page nav) and letting the Generate finish shows
//       "A lesson was finished after you left the page…" — never "ready … save".
// Demo data; /api/* mocked. Runs at 390x844 and 1366x768 (VIEWPORT=WxH).
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chromiumPath } from "./chromium.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const CHROMIUM = chromiumPath();
const [vw, vh] = (process.env.VIEWPORT || "390x844").split("x").map(Number);
const mobile = vw < 700;
const json = (b, s = 200) => ({ status: s, contentType: "application/json", body: JSON.stringify(b) });
const pass = [];
const fail = [];
const check = (c, m) => (c ? pass : fail).push(m);

const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
w.classes = w.classes.map((c) => ({ ...c, demo: false, gradingMode: "percentage" }));
w.lessons = [{
  id: "plan-1", classId: "demo", standard: "4.NBT.B.5", title: "Reteach place value", duration: 15,
  modality: "Visual", notes: "", date: "2026-11-25", completed: false, studentIds: [], origin: "ai",
  custom: { objective: "Obj", materials: ["m"], phases: [{ time: "0–5", name: "Launch", text: "go" }], practice: [{ q: "p?", a: "1" }], exit: [{ q: "e?", a: "2" }] },
}];

const lesson = { objective: "O", materials: ["m"], phases: [{ time: "0–5", name: "Launch", text: "go" }], practice: [{ q: "p?", a: "1" }], exit: [{ q: "e?", a: "2" }] };
const flow = { materials: ["m"], phases: [{ time: "0–5", name: "Launch", text: "go" }] };

async function tapNav(page, name) {
  const trig = page.getByRole("button", { name: "Toggle Sidebar" }).first();
  if (await trig.isVisible().catch(() => false)) { await trig.click(); await page.waitForTimeout(300); }
  const link = page.getByRole("link", { name }).first();
  await link.waitFor({ state: "visible", timeout: 10000 });
  await link.click();
}

const browser = await chromium.launch({ executablePath: CHROMIUM });
const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, isMobile: mobile, hasTouch: mobile });
await ctx.route("**/api/workspace", (r) => r.request().method() === "GET" ? r.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null })) : r.fulfill(json({ revision: 8 })));
await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 500, used: 0, remaining: 500, can_scan: true })));
await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
// The charged full lesson takes 5 s; the two free flows return at once.
await ctx.route("**/api/analyze", async (r) => {
  let part = "full";
  try { part = JSON.parse(r.request().postData() || "{}").lessonPart || "full"; } catch { /* default */ }
  if (part === "full") { await new Promise((res) => setTimeout(res, 5000)); return r.fulfill(json({ result: lesson })); }
  return r.fulfill(json({ result: part === "flow" ? flow : lesson }));
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

async function startGenerate(p) {
  await p.goto(`${BASE}/lessons?standard=4.NBT.B.5`, { waitUntil: "networkidle", timeout: 30000 });
  await p.waitForTimeout(500);
  const btn = p.getByRole("button", { name: /Generate an AI lesson plan/ }).first();
  await btn.waitFor({ state: "visible", timeout: 10000 });
  await btn.click();
  await p.waitForTimeout(800); // now mid-generate (aiBusy), well inside the 5 s
}

try {
  // (a) + (b): mid-generate, the focus picker and Open lesson are blocked.
  await startGenerate(page);
  const focus = page.getByLabel("Reteach standard").first();
  check(await focus.isDisabled().catch(() => false), "the focus picker is disabled while generating");
  await page.getByRole("tab", { name: /Saved lesson plans/ }).first().click();
  await page.waitForTimeout(400);
  check(
    await page.getByText("Your lesson is still being written").first().isVisible().catch(() => false),
    "the saved-plans tab shows the still-being-written note",
  );
  const openBtn = page.getByRole("button", { name: /Open lesson/ }).first();
  check(await openBtn.isDisabled().catch(() => false), "Open lesson is disabled while generating");
  await page.waitForTimeout(5000); // let the generate finish before moving on

  // (c): leave the page mid-generate; the finished lesson is reported dropped.
  await startGenerate(page);
  await tapNav(page, /Classes/); // cross-page navigation unmounts the lessons view
  await page.waitForTimeout(6000); // the 5 s full resolves after we have left
  const dropped = await page.getByText(/A lesson was finished after you left the page/).first().isVisible().catch(() => false);
  const falseReady = await page.getByText(/lesson plan is ready/i).first().isVisible().catch(() => false);
  check(dropped, "a lesson finished after leaving is reported as not kept");
  check(!falseReady, "no misleading 'ready … save it' after leaving the page");

  check(errors.length === 0, `no page errors ${errors.join(" | ")}`);
  await page.screenshot({ path: join(OUT, "lesson-generate-guards.png") });
} catch (e) {
  fail.push(`stopped -- ${String(e.message || e).split("\n")[0]} ${errors.join(" | ")}`);
  await page.screenshot({ path: join(OUT, "lesson-generate-guards-FAILED.png") }).catch(() => {});
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
