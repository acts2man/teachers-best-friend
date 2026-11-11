// Review-before-confirm and the library gate (Ricky, 5 Nov 2026; #214 review),
// at 390x844 and 1366x768: a confirmed-but-unreviewed test stays OUT of the
// Assessment Library and shows "N to review"; a fully-reviewed confirmed test
// is in the library; on the answer-key tab the Confirm button is disabled with
// a reason until standards are reviewed AND every answer is filled on screen;
// and a test whose standards are all reviewed can be confirmed by TYPING the
// key on the answer-key tab (the confirm is gated on on-screen answers, not
// saved ones). Demo data; /api/* mocked.
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
  w.classes = w.classes.map((c) => ({ ...c, demo: false, gradingMode: "percentage" }));
  const math = w.assessments.find((a) => a.id === "math-demo"); // 8 q, 4 to review
  const ela = w.assessments.find((a) => a.id === "ela-demo");   // 6 q, 0 to review
  math.answerKeyVerified = true; // confirmed, but still 4 to review
  ela.answerKeyVerified = true;  // confirmed and fully reviewed
  // A "typed key" test: every standard reviewed (verified + standard), but the
  // saved answers are blank and the key is not confirmed yet.
  const typed = JSON.parse(JSON.stringify(ela));
  typed.id = "typed-key";
  typed.title = "Typed key test";
  typed.answerKeyVerified = false;
  typed.classIds = [];
  typed.responses = [];
  typed.questions = typed.questions.map((q) => ({ ...q, verified: true, standard: q.standard || "RL.4.1", answer: "" }));
  w.assessments.push(typed);

  let saved = null;
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route("**/api/workspace", (r) => {
    if (r.request().method() === "GET") return r.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }));
    saved = JSON.parse(r.request().postData() || "{}").workspace || saved;
    return r.fulfill(json({ revision: 8 }));
  });
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  await ctx.route("**/api/analyze**", (r) => r.fulfill(json({}, 500)));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  try {
    // Library: ela listed, math and the unconfirmed typed test not.
    await page.goto(`${BASE}/library`, { waitUntil: "networkidle" });
    const libText = await page.locator("main").first().innerText().catch(() => "");
    check(libText.includes(ela.title), `${tag}: the fully-reviewed test is in the library`);
    check(!libText.includes(math.title), `${tag}: the confirmed-but-unreviewed test is NOT in the library`);

    // Assessments list: math shows "Key confirmed · 4 to review".
    await page.goto(`${BASE}/assessments`, { waitUntil: "networkidle" });
    check(/Key confirmed · 4 to review/.test(await page.locator("main").innerText()), `${tag}: the Assessments list shows "Key confirmed · 4 to review"`);

    // Answer-key tab for the unreviewed test MUST load (fail, not skip, if not).
    await page.goto(`${BASE}/assessments?id=math-demo&tab=key`, { waitUntil: "networkidle" });
    const confirm = page.getByRole("button", { name: "Confirm answer key" });
    await confirm.waitFor({ timeout: 10000 });
    check(await confirm.isDisabled(), `${tag}: Confirm is disabled while standards are unreviewed`);
    check(/standards to review/i.test(await page.locator(".key-confirm").innerText()), `${tag}: the reason names the standards to review`);

    // The typed-key test: standards reviewed, answers blank -> type the key and confirm.
    await page.goto(`${BASE}/assessments?id=typed-key&tab=key`, { waitUntil: "networkidle" });
    const confirm2 = page.getByRole("button", { name: "Confirm answer key" });
    await confirm2.waitFor({ timeout: 10000 });
    check(await confirm2.isDisabled(), `${tag}: Confirm starts disabled while answers are blank`);
    check(/answers blank/i.test(await page.locator(".key-confirm").innerText()), `${tag}: the reason names the blank answers`);
    const boxes = page.getByRole("textbox", { name: /Expected answer for question/ });
    const nBoxes = await boxes.count();
    for (let i = 0; i < nBoxes; i++) await boxes.nth(i).fill("answer " + (i + 1));
    await page.waitForTimeout(150);
    check(!(await confirm2.isDisabled()), `${tag}: once the key is typed, Confirm enables`);
    await confirm2.click();
    await page.waitForTimeout(600);
    const savedTest = saved?.assessments?.find((a) => a.id === "typed-key");
    check(!!savedTest && savedTest.answerKeyVerified === true, `${tag}: the typed key is confirmed (answerKeyVerified saved true)`);
    check(!!savedTest && savedTest.questions.every((q) => q.answer.trim()), `${tag}: the typed answers are saved onto the questions`);

    check(errors.length === 0, `${tag}: no page errors ${errors.join(" | ")}`);
  } catch (e) {
    fail.push(`${tag}: stopped -- ${String(e.message || e).split("\n")[0]}`);
    await page.screenshot({ path: join(OUT, `review-FAILED-${W}.png`) });
  }
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
