// PR 3 item 2 (Ricky, 11 Oct): the green "Confirm N answers that match the key".
//
// Proven when, at 390px: the button is visible without scrolling right after
// partial credit is given, one tap confirms them, and class analysis cannot be
// reached while matches are unconfirmed.
//
// Real screens and real grading code; only the network is stood in for. The
// workspace is the demo one, with question 1 of the math demo left ungraded:
// some students' answers match the key (clean AI matches, not yet confirmed),
// the rest wrote something else, all of it waiting for the teacher.
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const CHROMIUM = process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const [W, H] = (process.env.VIEWPORT || "390x844").split("x").map(Number);

function fixture({ allMatchQ2 = false, shakyOne = false } = {}) {
  const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
  w.classes = w.classes.map((c) => ({ ...c, demo: false }));
  const a = w.assessments.find((x) => x.id === "math-demo");
  const q1 = a.questions[0].id;
  let i = 0;
  a.responses = a.responses.map((r) => {
    if (allMatchQ2 && r.questionId === a.questions[1].id)
      // A question every student got right: matches only, nothing to decide.
      return { ...r, answer: a.questions[1].answer, finalAnswer: a.questions[1].answer, correct: true, match: 100, confidence: 100, verified: false, misconception: "" };
    if (r.questionId !== q1) return { ...r, verified: true };
    if (shakyOne) {
      // #126 review: every answer matches the key, one read at only 70%.
      const conf = i++ === 3 ? 70 : 100;
      return { ...r, answer: a.questions[0].answer, finalAnswer: a.questions[0].answer, correct: true, match: 100, confidence: conf, verified: false, misconception: "" };
    }
    const match = i++ % 2 === 0;
    return match
      ? { ...r, answer: a.questions[0].answer, finalAnswer: a.questions[0].answer, correct: true, match: 100, confidence: 100, verified: false, misconception: "" }
      : { ...r, answer: "236", finalAnswer: "236", correct: false, match: undefined, confidence: 100, verified: false, misconception: "" };
  });
  return { w, a, q1, matches: a.responses.filter((r) => r.questionId === q1 && r.correct).map((r) => r.id) };
}

const pass = [];
const fail = [];
const check = (c, m) => (c ? pass : fail).push(m);
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

async function open(browser, opts) {
  const f = fixture(opts);
  let current = f.w;
  const saves = [];
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route("**/api/workspace", (r) => {
    if (r.request().method() === "GET")
      return r.fulfill(json({ workspace: current, revision: 7 + saves.length, aiReady: true, authProvider: "supabase", impersonating: null }));
    const body = JSON.parse(r.request().postData() || "{}");
    saves.push(body.workspace);
    current = body.workspace;
    return r.fulfill(json({ revision: 8 + saves.length }));
  });
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  await ctx.route("**/api/scans/session**", (r) => r.fulfill(json({ state: null, revision: 0 })));
  const page = await ctx.newPage();
  return { ...f, ctx, page, saves };
}

const browser = await chromium.launch({ executablePath: CHROMIUM });

// 1. Give partial credit to the group that needs it; the green button must be
//    on screen right away, and one tap confirms exactly the matching answers.
{
  const { page, ctx, saves, matches, q1 } = await open(browser);
  await page.goto(`${BASE}/assessments?id=math-demo&tab=responses`, { waitUntil: "networkidle" });
  await page.locator("#grade-by-question").getByRole("button", { name: /^Review/ }).first().click();
  const points = page.locator("#grade-by-question input[aria-label^='Points for the answer']").first();
  await points.waitFor({ timeout: 10000 });
  const max = Number(await points.getAttribute("max")) || 1;
  await points.fill(String(max / 2));
  await page.locator("#grade-by-question .gbq-credit").first().getByRole("button", { name: /^Give/ }).click();
  const button = page.locator(".confirm-matches-bar .confirm-matches");
  await button.waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
  const box = await button.boundingBox();
  check(!!box && box.y >= 0 && box.y + box.height <= H && box.x >= 0 && box.x + box.width <= W, `right after partial credit the green button is fully on screen without scrolling (y=${box && Math.round(box.y)}, height ${box && Math.round(box.height)}, viewport ${H})`);
  const label = await button.innerText();
  check(new RegExp(`Confirm ${matches.length} answers? that\\s+match the key`).test(label.replace(/\s+/g, " ")), `it says "Confirm ${matches.length} answers that match the key" (got "${label.replace(/\s+/g, " ")}")`);
  await page.mouse.move(1, 1); // the colour at rest, not the hover shade
  await page.waitForTimeout(200);
  const bg = await button.evaluate((el) => getComputedStyle(el).backgroundColor);
  check(bg === "rgb(31, 138, 76)", `it is green (${bg})`);
  await page.screenshot({ path: join(OUT, `confirm-matches-after-partial-${W}x${H}.png`) });
  const before = saves.length;
  await button.click();
  await page.waitForTimeout(800);
  check(saves.length === before + 1, "one tap, one save");
  const saved = saves.at(-1)?.assessments.find((x) => x.id === "math-demo");
  const confirmed = matches.filter((id) => saved?.responses.find((r) => r.id === id)?.verified);
  check(confirmed.length === matches.length, `all ${matches.length} matching answers confirmed (${confirmed.length})`);
  const stillCorrect = matches.every((id) => saved?.responses.find((r) => r.id === id)?.correct === true);
  check(stillCorrect, "and they stay marked correct");
  const others = saved?.responses.filter((r) => r.questionId === q1 && !matches.includes(r.id));
  check(others.every((r) => r.verified && r.match === 50), "the partial-credit group kept its half credit");
  await ctx.close();
}

// 2. Class analysis cannot be reached while matches are unconfirmed.
{
  const { page, ctx, saves } = await open(browser);
  await page.goto(`${BASE}/assessments?id=math-demo&tab=analysis`, { waitUntil: "networkidle" });
  const gate = page.getByText("One step before class analysis");
  check((await gate.count()) === 1, "opening class analysis with unconfirmed matches shows the confirm step instead");
  await page.screenshot({ path: join(OUT, `confirm-matches-analysis-gate-${W}x${H}.png`) });
  await page.getByRole("tab", { name: "Class analysis" }).click().catch(() => {});
  check((await gate.count()) === 1, "and the tab still shows the confirm step");
  await page.locator(".panel .confirm-matches").first().click();
  await page.waitForTimeout(900);
  // The rest of question 1 (the "236" answers) is still the teacher's to
  // decide, so after the one tap the analysis waits on THAT (#126 review),
  // not on the matches.
  check(saves.length === 1 && (await page.locator(".panel .confirm-matches").count()) === 0, "one tap there confirms the matches (one save)");
  check((await page.getByText(/answers? still needs? your decision/).count()) === 1, "and the step moves on to the answers still to decide, not to an analysis that would leave them out");
  await ctx.close();
}

// 3. Reviewer finding (PR 3): a question every student got right has nothing
//    to decide, so no credit is ever given on it. The green button must still
//    be there when the app moves the teacher onto it.
{
  const { page, ctx, saves, a } = await open(browser, { allMatchQ2: true });
  const q2 = a.questions[1];
  await page.goto(`${BASE}/assessments?id=math-demo&tab=responses`, { waitUntil: "networkidle" });
  await page.locator("#grade-by-question").getByRole("button", { name: /^Review/ }).first().click();
  const points = page.locator("#grade-by-question input[aria-label^='Points for the answer']").first();
  await points.waitFor({ timeout: 10000 });
  await points.fill(String((Number(await points.getAttribute("max")) || 1) / 2));
  await page.locator("#grade-by-question .gbq-credit").first().getByRole("button", { name: /^Give/ }).click();
  await page.locator(".confirm-matches-bar .confirm-matches").click({ timeout: 10000 });
  const onQ2 = await page.locator("#grade-by-question").getByText(new RegExp("^Q" + q2.number + " ·")).first().waitFor({ timeout: 10000 }).then(() => true, () => false);
  check(onQ2, `after Q1, the app moves on to Q${q2.number}, where every student matched the key`);
  const bar = page.locator(".confirm-matches-bar .confirm-matches");
  const shown = await bar.waitFor({ timeout: 5000 }).then(() => true, () => false);
  const box = shown ? await bar.boundingBox() : null;
  check(shown && !!box && box.y + box.height <= H, "there, with nothing to decide, the green button is on screen (no dead end)");
  await page.screenshot({ path: join(OUT, `confirm-matches-all-match-${W}x${H}.png`) });
  if (shown) {
    const before = saves.length;
    await bar.click();
    await page.waitForTimeout(900);
    const saved = saves.at(-1)?.assessments.find((x) => x.id === "math-demo");
    check(saves.length === before + 1 && saved.responses.filter((r) => r.questionId === q2.id).every((r) => r.verified && r.correct), `one tap confirms all of Q${q2.number}`);
  }
  await ctx.close();
}

// 4. #126 review: 23 clean matches + 1 read at 70%. Proven when: 23 to
//    confirm plus 1 to decide, and class analysis stays blocked until the 1 is
//    decided.
{
  const { page, ctx, saves, a, q1 } = await open(browser, { shakyOne: true });
  const n = a.responses.filter((r) => r.questionId === q1).length;
  await page.goto(`${BASE}/assessments?id=math-demo&tab=analysis`, { waitUntil: "networkidle" });
  const confirm = page.locator(".panel .confirm-matches").first();
  const label = (await confirm.innerText()).replace(/\s+/g, " ");
  check(new RegExp(`Confirm ${n - 1} answers`).test(label), `analysis gate offers ${n - 1} matches to confirm, not ${n} (got "${label}")`);
  await confirm.click();
  await page.waitForTimeout(900);
  const decideGate = page.getByText(/1 answer still needs your decision/);
  check((await decideGate.count()) === 1, "after confirming them, analysis is still blocked: 1 answer still needs a decision");
  check((await page.locator(".class-analysis, [data-testid=class-analysis]").count()) === 0 || (await decideGate.count()) === 1, "class analysis itself is not shown");
  await page.screenshot({ path: join(OUT, `confirm-matches-decide-gate-${W}x${H}.png`) });
  if (!(await decideGate.count())) {
    // Before the fix: no such gate, the class analysis just opened.
    check(false, "(stopped: no decide step to continue from)");
    await ctx.close();
  } else {
  await page.getByRole("button", { name: /Grade it now/ }).click();
  await page.locator("#grade-by-question").getByRole("button", { name: /^Review/ }).first().click();
  const shaky = page.locator(".gbq-group", { hasText: "wasn’t fully sure" }).first();
  check((await shaky.count()) === 1, "the 70% read is its own group, labelled for a check");
  const points = shaky.locator("input[aria-label^='Points for the answer']").first();
  await points.fill(String(Number(await points.getAttribute("max")) || 1));
  await shaky.locator(".gbq-credit").getByRole("button", { name: /^Give/ }).click();
  await page.waitForTimeout(900);
  await page.goto(`${BASE}/assessments?id=math-demo&tab=analysis`, { waitUntil: "networkidle" });
  check((await page.getByText("One step before class analysis").count()) === 0, `once it is decided, class analysis opens (${saves.length} saves)`);
  await ctx.close();
  }
}

await browser.close();
console.log(`=== GREEN CONFIRM STEP (${W}x${H}) ===`);
for (const p of pass) console.log("  OK   " + p);
for (const f of fail) console.log("  FAIL " + f);
console.log(`\n${pass.length}/${pass.length + fail.length} assertions passed`);
process.exit(fail.length ? 1 : 0);
