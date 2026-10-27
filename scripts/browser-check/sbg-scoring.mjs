// 0–4 scoring on a Standards-Based test (26 Oct 2026), at 390x844 and
// 1366x768, on the demo math test switched to Standards-Based.
//
// Proven when:
//   - Grade by question offers five buttons, 0 to 4, for a group of wrong
//     answers (no "__ of N points" box), and tapping 3 saves each answer in the
//     group at 3 (match 75), confirmed;
//   - the student's result reads "N.N" "out of 4 · <level>" and each standard
//     "N.N average (0–4) · <level>";
//   - Class analysis reads "Class average N.N out of 4" with the 0–4 ranges;
//   - the test page has no "coming next" note;
//   - the Standard Tracker reads the Standards-Based test as "N.N / 4" and a
//     check-in as a percentage.
// Seeded demo data with made-up students; /api/* is mocked.
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const SHOTS = join(OUT, "sbg-scoring");
mkdirSync(SHOTS, { recursive: true });
const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const CHROMIUM = process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const pass = [];
const fail = [];
const check = (c, m) => (c ? pass : fail).push(m);

function fixture() {
  const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
  w.classes = w.classes.map((c) => ({ ...c, demo: false }));
  const a = w.assessments.find((x) => x.id === "math-demo");
  a.gradingMode = "sbg";
  // Q1's wrong answers wait for the teacher, as the AI leaves them ("other").
  const q1 = a.questions[0];
  for (const r of a.responses.filter((r) => r.questionId === q1.id && !r.correct)) Object.assign(r, { verified: false, match: undefined });
  // Student s1 has a 2 on every question of their first standard.
  const code = a.questions[1].standard;
  for (const r of a.responses.filter((r) => r.studentId === "s1" && a.questions.find((q) => q.id === r.questionId)?.standard === code))
    Object.assign(r, { match: 50, correct: false, verified: true });
  const s1 = w.students.find((s) => s.id === "s1");
  s1.evidence.push({ id: "e-sbg", standard: code, score: 50, date: "2026-10-20", source: a.title, assessmentId: a.id });
  return { w, a, q1, code };
}

const browser = await chromium.launch({ executablePath: CHROMIUM });
for (const [W, H] of [[390, 844], [1366, 768]]) {
  const tag = `${W}x${H}`;
  const { w, a, q1, code } = fixture();
  let current = w;
  const saves = [];
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route("**/api/workspace", (r) => {
    if (r.request().method() === "GET")
      return r.fulfill(json({ workspace: current, revision: 7 + saves.length, aiReady: true, authProvider: "supabase", impersonating: null }));
    current = JSON.parse(r.request().postData() || "{}").workspace;
    saves.push(current);
    return r.fulfill(json({ revision: 8 + saves.length }));
  });
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  await ctx.route("**/api/scans/session**", (r) => r.fulfill(json({ state: null, revision: 0 })));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  try {
    // ---- the test page: no "coming next" note ----
    await page.goto(`${BASE}/assessments?id=math-demo&tab=questions`, { waitUntil: "networkidle" });
    const row = (await page.locator(".grading-mode-row").innerText()).replace(/\s+/g, " ");
    check(/Standards-Based/.test(row) && !/coming next/i.test(row), `${tag}: the mode row (${row})`);

    // ---- Grade by question: 0–4 for a group of wrong answers ----
    await page.goto(`${BASE}/assessments?id=math-demo&tab=responses`, { waitUntil: "networkidle" });
    const gbq = page.locator("#grade-by-question");
    check(/0–4/.test(await gbq.locator(".gbq-question strong").first().innerText()), `${tag}: questions are out of 0–4, not points`);
    await gbq.getByRole("button", { name: /^Review/ }).first().click();
    const group = gbq.locator(".gbq-score4").first();
    await group.waitFor({ timeout: 10000 });
    const buttons = (await group.locator("button").allInnerTexts()).map((t) => t.trim());
    check(JSON.stringify(buttons.slice(0, 5)) === JSON.stringify(["0", "1", "2", "3", "4"]), `${tag}: five score buttons (${buttons.join(" ")})`);
    check((await gbq.locator("input[aria-label^='Points for the answer']").count()) === 0, `${tag}: no points box`);
    await page.screenshot({ path: join(SHOTS, `gbq-${tag}.png`) });
    const who = await group.getAttribute("aria-label");
    const before = saves.length;
    await group.getByRole("button", { name: /^Score 3 for/ }).click();
    await page.waitForTimeout(800);
    const saved = saves.at(-1)?.assessments.find((x) => x.id === a.id);
    const graded = saved?.responses.filter((r) => r.questionId === q1.id && r.verified && r.match === 75) ?? [];
    check(saves.length > before && graded.length > 0, `${tag}: Score 3 saved ${graded.length} answer(s) at 75, confirmed (${who})`);

    // ---- one student's result and standards ----
    await page.goto(`${BASE}/assessments?id=math-demo&tab=responses&student=s1`, { waitUntil: "networkidle" });
    const score = page.locator(".review-score");
    await score.waitFor({ timeout: 10000 });
    const strong = (await score.locator("strong").innerText()).trim();
    const sub = (await score.locator(".review-score-points").innerText()).trim();
    check(/^\d\.\d$/.test(strong) && /^out of 4 · (Beginning|Approaching|Proficient|Exceeding)$/.test(sub), `${tag}: the student's result reads "${strong}" "${sub}"`);
    const std = (await page.locator(".student-standard-result").filter({ hasText: code }).first().innerText()).replace(/\s+/g, " ");
    check(/2\.0 average \(0–4\) · Approaching/.test(std), `${tag}: ${code} reads its 0–4 average and level (${std.slice(0, 90)})`);
    await page.locator(".student-review-summary").screenshot({ path: join(SHOTS, `student-${tag}.png`) });

    // ---- class analysis ----
    await page.goto(`${BASE}/assessments?id=math-demo&tab=analysis`, { waitUntil: "networkidle" });
    const card = page.locator(".skill-gap-groups .student-group-card").first();
    await card.waitFor({ timeout: 10000 });
    const text = (await card.innerText()).replace(/\s+/g, " ");
    check(/Class average \d\.\d out of 4/.test(text), `${tag}: class analysis reads out of 4 (${text.slice(0, 120)})`);
    check(/(0–1\.9|2\.0–2\.9|3\.0–3\.4|3\.5–4)/.test(text) && !/\d+–\d+%/.test(text), `${tag}: class analysis uses the 0–4 ranges`);
    // The DOK grid agrees with the card: 0–4 scores, the 0–4 legend (#184 review).
    const cells = await page.locator(".dok-cell strong").allInnerTexts();
    check(cells.length > 0 && cells.every((c) => /^\d\.\d$/.test(c.trim())), `${tag}: DOK grid cells read 0–4 (${cells.slice(0, 6).join(", ")})`);
    const legend = (await page.locator(".dok-grid-legend").innerText()).replace(/\s+/g, " ");
    check(/Beginning 0–1\.9/.test(legend) && !/%/.test(legend), `${tag}: DOK grid legend uses the 0–4 ranges (${legend})`);
    const cardScore = /Class average (\d\.\d) out of 4/.exec(text)?.[1];
    const cardCode = /(\S+) · Class average/.exec(text)?.[1];
    const gridCells = await page.locator(".dok-grid-row", { hasText: cardCode }).locator(".dok-cell strong").allInnerTexts();
    check(!!cardScore && gridCells.length === 1 ? gridCells[0].trim() === cardScore : true, `${tag}: a standard with one DOK reads the same in the grid as on its card (${cardCode}: ${cardScore} / ${gridCells.join(",")})`);

    // ---- the Standard Tracker ----
    await page.goto(`${BASE}/students?id=s1&standard=${encodeURIComponent(code)}`, { waitUntil: "networkidle" });
    const list = page.locator(".evidence-list");
    await list.waitFor({ timeout: 10000 });
    const items = (await list.innerText()).replace(/\s+/g, " ");
    check(/2\.0 \/ 4/.test(items), `${tag}: the tracker reads the Standards-Based test 0–4 (${items.slice(0, 160)})`);
    check(/\d+%/.test(items), `${tag}: and a percentage record as a percentage`);
    // The headline averages both kinds, so it stays a percentage and says so.
    const note = await page.locator(".tracker-mixed-note").innerText().catch(() => "");
    check(/mix percentage and Standards-Based \(0–4\) tests/.test(note), `${tag}: the headline says why it is a percentage`);
    await page.locator(".trajectory-panel").screenshot({ path: join(SHOTS, `tracker-${tag}.png`) });
    // ---- a student with an undecided answer: "Provisional", no level ----
    // (Last: an undecided answer holds Class analysis back.) The server now
    // has student s3's answer to the last question still undecided.
    current = structuredClone(current);
    const t = current.assessments.find((x) => x.id === a.id);
    Object.assign(t.responses.find((r) => r.studentId === "s3" && r.questionId === t.questions.at(-1).id), { verified: false, match: undefined, correct: false });
    const undecided = "s3";
    if (undecided) {
      await page.goto(`${BASE}/assessments?id=math-demo&tab=responses&student=${undecided}`, { waitUntil: "networkidle" });
      const sub2 = (await page.locator(".review-score .review-score-points").innerText({ timeout: 10000 })).trim();
      check(sub2 === "out of 4 · Provisional", `${tag}: a student with an undecided answer reads "${sub2}"`);
    } else fail.push(`${tag}: no student left with an undecided answer`);

    check(errors.length === 0, `${tag}: no page errors ${errors.join(" | ")}`);
  } catch (e) {
    fail.push(`${tag}: stopped -- ${String(e.message || e).split("\n")[0]}`);
    await page.screenshot({ path: join(SHOTS, `FAILED-${tag}.png`), fullPage: true });
  }
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
