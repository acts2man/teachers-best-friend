// "Record exit check" on a whole-class lesson (review of #198), at 390x844
// and 1366x768: a lesson saved with no student picked lists every student in
// the class, and a result recorded for one of them is saved as evidence.
// Demo data; /api/* mocked.
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

const browser = await chromium.launch({ executablePath: CHROMIUM });
for (const [W, H] of [[390, 844], [1366, 768]]) {
  const tag = `${W}x${H}`;
  const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
  w.classes = w.classes.map((c) => ({ ...c, demo: false }));
  const inClass = w.students.filter((s) => s.classId === "demo");
  w.lessons = [{ id: "whole", classId: "demo", standard: "4.OA.A.3", title: "Whole-class reteach", duration: 15, modality: "Visual", notes: "", date: "2026-11-05", completed: false, studentIds: [], origin: "template" }];
  let saved = null;
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route("**/api/workspace", (r) => {
    if (r.request().method() === "GET") return r.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }));
    saved = JSON.parse(r.request().postData() || "{}").workspace;
    return r.fulfill(json({ revision: 8 }));
  });
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  try {
    await page.goto(`${BASE}/lessons`, { waitUntil: "networkidle" });
    await page.getByRole("tab", { name: /Saved lesson plans/ }).click();
    await page.getByRole("button", { name: "Record exit check" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ timeout: 8000 });
    const rows = await dialog.locator(".exit-score-list > div").count();
    check(rows === inClass.length, `${tag}: every student in the class is listed (${rows} of ${inClass.length})`);
    check(/A whole-class lesson: everyone in the class is listed\./.test(await dialog.innerText()), `${tag}: and it says why`);
    const first = [...inClass].sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: "base" }))[0];
    await dialog.getByRole("combobox", { name: "Exit result for " + first.name }).click();
    await page.getByRole("option", { name: "2 of 2" }).click();
    await dialog.getByRole("button", { name: /Save results/ }).click();
    await page.waitForTimeout(700);
    const s = saved?.students?.find((x) => x.id === first.id);
    check(!!s && s.evidence.some((e) => e.id === "exit-whole-" + first.id && e.score === 100), `${tag}: a result recorded for ${first.name} is saved as evidence`);
    check(errors.length === 0, `${tag}: no page errors ${errors.join(" | ")}`);
  } catch (e) {
    fail.push(`${tag}: stopped -- ${String(e.message || e).split("\n")[0]}`);
    await page.screenshot({ path: join(OUT, `exit-check-whole-class-FAILED-${W}.png`) });
  }
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
