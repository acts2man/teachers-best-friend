// Ricky, 17 Nov 2026 (iPhone Chrome iOS, production): opened a saved lesson,
// refreshed, tapped another menu option and came back to Lesson Planning — and
// it was still stuck on the previous lesson, with the standard unchangeable.
//
// Cause: the screens are force-static pages (app/[view]/page.tsx). Next 16.2.6's
// client router keeps the /lessons route's cached URL — including a stale
// ?lesson= — so returning to Lesson Planning re-opened the last lesson.
//
// This walks that exact path on `next build --webpack` + `next start` at
// 390x844 (Android/iPhone-sized): open a saved lesson → full reload → tap
// another sidebar item → tap Lesson Planning → the Start panel is back (no
// stale ?lesson=) and a standard can be chosen and changed. It then proves the
// SAME-PAGE tap (review of #216): with ?lesson=, ?tab=plan and ?start=scratch
// each loaded fresh, tapping Lesson Planning while already on /lessons also
// returns to the Start panel with no stale param. Demo data; /api/* mocked.
// FAILS on fa78647 (the lesson stays open); passes with the fix.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chromiumPath } from "./chromium.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const CHROMIUM = chromiumPath();
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

async function tapNav(page, name) {
  const trig = page.getByRole("button", { name: "Toggle Sidebar" }).first();
  if (await trig.isVisible().catch(() => false)) { await trig.click(); await page.waitForTimeout(300); }
  const link = page.getByRole("link", { name }).first();
  await link.waitFor({ state: "visible", timeout: 10000 });
  await link.click();
  await page.waitForTimeout(900);
}

// Default to Ricky's iPhone-sized repro; VIEWPORT=1366x768 runs it on desktop.
const [vw, vh] = (process.env.VIEWPORT || "390x844").split("x").map(Number);
const mobile = vw < 700;
const browser = await chromium.launch({ executablePath: CHROMIUM });
const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, isMobile: mobile, hasTouch: mobile });
await ctx.route("**/api/workspace", (r) => r.request().method() === "GET" ? r.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null })) : r.fulfill(json({ revision: 8 })));
await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 500, used: 0, remaining: 500, can_scan: true })));
await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
try {
  // Open a saved lesson; confirm it opens (the intentional-open path still works).
  await page.goto(`${BASE}/lessons?lesson=plan-1`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(500);
  check(await page.locator(".studio-layout").isVisible().catch(() => false), "opening a saved lesson shows it");

  // Full reload (as Ricky did), then jump to another sidebar item and back.
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await tapNav(page, /Classes/);
  check(/\/classes/.test(page.url()), `the other menu option opened (${page.url().replace(BASE, "")})`);
  await tapNav(page, /Lesson Planning/);

  // The core fix: back on Lesson Planning, it is NOT stuck on the old lesson.
  const url = page.url().replace(BASE, "");
  check(!/[?&]lesson=/.test(url) && !/[?&]standard=/.test(url), `no stale lesson/standard in the URL (${url})`);
  check(await page.getByRole("heading", { name: "Start a lesson" }).isVisible().catch(() => false), "the Start panel is shown again");
  check(!(await page.locator(".studio-layout").isVisible().catch(() => false)), "the previous lesson is no longer open");

  // And a standard can be chosen and then changed (what Ricky could not do).
  await page.getByRole("button", { name: /Data-driven lesson/ }).click();
  await page.waitForTimeout(600);
  check(await page.locator(".studio-layout").isVisible().catch(() => false), "choosing a focus opens the lesson studio");
  const focus = page.getByLabel("Reteach standard");
  const before = ((await focus.textContent().catch(() => "")) || "").trim();
  await focus.click();
  await page.waitForTimeout(250);
  await page.getByRole("option").nth(3).click();
  await page.waitForTimeout(400);
  const after = ((await focus.textContent().catch(() => "")) || "").trim();
  check(!!before && !!after && before !== after, `the standard can be changed ("${before}" -> "${after}")`);

  // Review of #216 — the SAME-PAGE tap. Each entry param loaded fresh (full
  // load, no SPA history), then Lesson Planning tapped while already on
  // /lessons must still land on the Start panel with no stale param.
  for (const entry of ["lessons?lesson=plan-1", "lessons?tab=plan", "lessons?start=scratch"]) {
    await page.goto(`${BASE}/${entry}`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(500);
    await tapNav(page, /Lesson Planning/); // same view, no remount
    const u = page.url().replace(BASE, "");
    const clean = !/[?&](lesson|standard|tab|start)=/.test(u);
    const atStart = await page.getByRole("heading", { name: "Start a lesson" }).isVisible().catch(() => false);
    check(clean && atStart, `same-page tap from ?${entry.split("?")[1]} returns to Start with a clean URL (${u}, start=${atStart})`);
  }

  check(errors.length === 0, `no page errors ${errors.join(" | ")}`);
  await page.screenshot({ path: join(OUT, "lesson-return-fresh.png") });
} catch (e) {
  fail.push(`stopped -- ${String(e.message || e).split("\n")[0]} ${errors.join(" | ")}`);
  await page.screenshot({ path: join(OUT, "lesson-return-fresh-FAILED.png") }).catch(() => {});
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
