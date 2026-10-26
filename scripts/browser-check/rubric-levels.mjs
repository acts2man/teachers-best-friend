// Writing rubric levels (26 Oct 2026), in a browser at 390x844 and 1366x768.
//
// Proven when, on a made-up writing test: a student's trait scored 2 shows a
// "2 Approaching" badge in the Approaching colour, the 4-point buttons read
// "1 Beginning" ... "4 Exceeding", and the class analysis lists that student
// under Approaching (read as 50% it was the lowest level), with the trait's
// average level from the 0–4 cuts. Nothing scrolls sideways. /api/* mocked.
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const SHOTS = process.env.SHOTS || join(OUT, "rubric-levels");
const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const CHROMIUM = process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const pass = [];
const fail = [];
const check = (c, m) => (c ? pass : fail).push(m);
mkdirSync(SHOTS, { recursive: true });

const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
w.classes = w.classes.map((c) => ({ ...c, demo: false }));
const cls = w.classes[0].id;
const kids = w.students.filter((s) => s.classId === cls).slice(0, 3);
const trait = { id: "trait-evidence", name: "Evidence", max: 4, descriptor: "Uses evidence. (1 Beginning, 2 Approaching, 3 Proficient, 4 Exceeding.)", standard: "W.4.1" };
const r = (s, score) => ({ id: "wr-" + s.id, studentId: s.id, questionId: trait.id, answer: "", correct: score === 4, match: score * 25, rubricScore: score, misconception: "", confidence: 90, verified: true });
w.assessments.push({
  id: "w-demo", classId: cls, title: "Opinion essay", subject: "ELA", elaArea: "writing", genre: "opinion", grade: 4, framework: "Common Core",
  createdAt: "2026-10-20T00:00:00.000Z", status: "Ready", source: "manual", targetStandards: ["W.4.1"], answerKeyVerified: true,
  uploadIds: [], questions: [], rubric: [trait], responses: [r(kids[0], 2), r(kids[1], 2), r(kids[2], 3)],
});

const browser = await chromium.launch({ executablePath: CHROMIUM });
for (const [W, H] of [[390, 844], [1366, 768]]) {
  const tag = `${W}x${H}`;
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route("**/api/workspace", (rt) =>
    rt.request().method() === "GET"
      ? rt.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }))
      : rt.fulfill(json({ revision: 8 })),
  );
  await ctx.route("**/api/quota", (rt) => rt.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
  await ctx.route("**/api/events", (rt) => rt.fulfill({ status: 204, body: "" }));
  await ctx.route("**/api/scans/session**", (rt) => rt.fulfill(json({ state: null, revision: 0 })));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/assessments?id=w-demo&tab=responses&student=${kids[0].id}`, { waitUntil: "networkidle" });
  const row = page.locator(".class-scan-row").filter({ hasText: "Evidence" }).first();
  await row.waitFor({ timeout: 15000 });
  const badge = row.locator(".pill.level-yellow");
  const badgeText = (await badge.count()) ? (await badge.first().innerText()).trim() : "";
  check(badgeText === "2 Approaching", `${tag}: a score of 2 shows "2 Approaching" in the Approaching colour (${badgeText || "none"})`);
  const buttons = (await row.locator(".review-heading-actions button").allInnerTexts()).map((t) => t.trim());
  check(JSON.stringify(buttons.slice(0, 5)) === JSON.stringify(["0", "1 Beginning", "2 Approaching", "3 Proficient", "4 Exceeding"]), `${tag}: the score buttons are named (${buttons.slice(0, 5).join(" | ")})`);
  await row.screenshot({ path: join(SHOTS, `trait-${tag}.png`) });
  check(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), `${tag}: student writing: no sideways scroll`);

  await page.goto(`${BASE}/assessments?id=w-demo&tab=analysis`, { waitUntil: "networkidle" });
  const card = page.locator(".student-group-card").filter({ hasText: "Evidence" }).first();
  await card.waitFor({ timeout: 15000 });
  const text = (await card.innerText()).replace(/\s+/g, " ");
  check(/Avg 2\.3 \/ 4 · Approaching/.test(text), `${tag}: the trait's average and level (${text.slice(0, 60)})`);
  check(/Approaching · 2\.0–2\.9 \(2\)/.test(text), `${tag}: the two students who scored 2 are under Approaching, with the 0–4 range`);
  check(!/%/.test(text), `${tag}: no percentage on a 0–4 trait's card`);
  check(!/Beginning/.test(text), `${tag}: nobody who scored 2 is under Beginning`);
  await card.screenshot({ path: join(SHOTS, `class-${tag}.png`) });
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
