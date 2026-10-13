// #126 round 3, items 1a and 1c, in a browser at 390x844 and 1366x768.
//
// 1a. Give credit on one group so the green bar is up, then "Grade on their
//     own" on one student in the matching group: the bar must count one fewer,
//     and tapping it must leave that student undecided (it confirmed him at
//     100% while his own credit form was open).
// 1c. Ricky's question 8: a question whose answers were all read as blank. Pull
//     one student out, grade them and the group at the SAME credit: they stay
//     two cards (they merged back before), across a reload, and "Change" on
//     the group never regrades the one pulled out.
// Seeded demo data only; /api/* is mocked and every save is kept so a reload
// reads back exactly what was saved.
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

function fixture() {
  const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
  w.classes = w.classes.map((c) => ({ ...c, demo: false }));
  const a = w.assessments.find((x) => x.id === "math-demo");
  const [q1, q2] = a.questions;
  const wrong = ["236", "240"];
  let i = 0;
  a.responses = a.responses.map((r) => {
    const base = { ...r, confidence: 100, verified: false, misconception: "", gradedAlone: undefined };
    if (r.questionId === q1.id) {
      const k = i++;
      // Q1: half match the key, half one of two wrong answers.
      return k % 2 === 0
        ? { ...base, answer: q1.answer, finalAnswer: q1.answer, correct: true, match: 100 }
        : { ...base, answer: wrong[k % 4 === 1 ? 0 : 1], finalAnswer: wrong[k % 4 === 1 ? 0 : 1], correct: false, match: undefined };
    }
    // Q2: every answer read as blank (Ricky's question 8).
    if (r.questionId === q2.id) return { ...base, answer: "", finalAnswer: "", correct: false, match: 0 };
    return { ...r, verified: true };
  });
  return { w, q1, q2 };
}

async function bar(page) {
  return page.evaluate(() => {
    const wrap = document.querySelector(".confirm-matches-bar");
    const b = wrap?.querySelector(".confirm-matches");
    return b ? { text: b.textContent.trim(), tucked: wrap.classList.contains("is-tucked") } : null;
  });
}

/** Tap the bar the way a teacher would: find a scroll position where it is
 * showing, then a real click (a tucked bar cannot be clicked). */
async function tapBar(page) {
  const total = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  for (let y = 0; y <= total + 40; y += 40) {
    await page.evaluate((y) => window.scrollTo(0, y), y);
    await page.waitForTimeout(60);
    const b = await bar(page);
    if (b && !b.tucked) {
      await page.locator(".confirm-matches-bar .confirm-matches").click();
      return true;
    }
  }
  return false;
}

/** The pulled-out student's own controls: their own card (this build) or,
 * on the build before, their row inside the old group's card. */
async function ownBox(panel, name) {
  const card = panel.locator("[data-alone]").filter({ hasText: name });
  if (await card.count()) return card.first();
  return panel.locator(".gbq-students li").filter({ hasText: name }).first();
}

/** Each phase reports a failure instead of stopping the run, so the build
 * before the fix gets a score too. */
async function phase(name, fn) {
  try {
    await fn();
  } catch (e) {
    fail.push(name + ": stopped -- " + String(e.message || e).split("\n")[0]);
  }
}

const browser = await chromium.launch({ executablePath: CHROMIUM });
for (const [W, H] of [[390, 844], [1366, 768]]) {
  const { w, q1, q2 } = fixture();
  let current = w;
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route("**/api/workspace", (r) => {
    if (r.request().method() === "GET") return r.fulfill(json({ workspace: current, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }));
    current = JSON.parse(r.request().postData()).workspace;
    return r.fulfill(json({ revision: 8 }));
  });
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  await ctx.route("**/api/scans/session**", (r) => r.fulfill(json({ state: null, revision: 0 })));
  const page = await ctx.newPage();
  const saved = () => current.assessments.find((x) => x.id === "math-demo").responses;
  const panel = page.locator("#grade-by-question");

  // ---- 1a ------------------------------------------------------------------
  await phase(`${W}x${H} 1a`, async () => {
  await page.goto(`${BASE}/assessments?id=math-demo&tab=responses`, { waitUntil: "networkidle" });
  await panel.getByRole("button", { name: /^Review/ }).first().click();
  await panel.locator("input[aria-label^='Points for the answer']").first().waitFor({ timeout: 10000 });
  // Decide one wrong-answer group, so the bar comes up.
  await panel.locator("input[aria-label^='Points for the answer']").first().fill("0");
  await panel.locator(".gbq-credit").first().getByRole("button", { name: /^Give/ }).click();
  await page.locator(".confirm-matches-bar .confirm-matches").waitFor({ timeout: 10000 });
  const matches = saved().filter((r) => r.questionId === q1.id && r.correct).length;
  const before = await bar(page);
  check(before?.text.includes(`Confirm ${matches} `), `${W}x${H} 1a: the bar starts at "Confirm ${matches}" (got "${before?.text}")`);
  // "Grade on their own" on the 3rd student of the matching group.
  const matchingCard = panel.locator(".gbq-group").filter({ hasText: "Matches your key" }).first();
  const row = matchingCard.locator(".gbq-students li").nth(2);
  const name = (await row.locator(".gbq-student-head > span").first().innerText()).trim();
  const sid = current.students.find((x) => x.name === name)?.id;
  const pulledId = saved().find((r) => r.questionId === q1.id && r.studentId === sid)?.id;
  await row.getByRole("button", { name: "Grade on their own" }).click();
  await page.waitForTimeout(600);
  check(!!saved().find((r) => r.id === pulledId)?.gradedAlone, `${W}x${H} 1a: "Grade on their own" is saved with the answer`);
  const after = await bar(page);
  check(after?.text.includes(`Confirm ${matches - 1} `), `${W}x${H} 1a: the bar now says "Confirm ${matches - 1}" (got "${after?.text}")`);
  const own = await ownBox(panel, name);
  check((await own.locator(".gbq-credit").count()) === 1, `${W}x${H} 1a: the pulled-out student has their own credit form`);
  await page.screenshot({ path: join(OUT, `graded-alone-1a-${W}.png`) });
  check(await tapBar(page), `${W}x${H} 1a: the bar could be tapped`);
  await page.waitForTimeout(600);
  const p = saved().find((r) => r.id === pulledId);
  const others = saved().filter((r) => r.questionId === q1.id && r.correct && r.id !== pulledId);
  check(p && p.verified === false, `${W}x${H} 1a: one tap on the bar left the pulled-out student undecided (verified=${p?.verified})`);
  check(others.length === matches - 1 && others.every((r) => r.verified), `${W}x${H} 1a: and confirmed the other ${matches - 1}`);
  check((await (await ownBox(panel, name)).locator(".gbq-credit").count()) === 1, `${W}x${H} 1a: their credit form is still open after the tap`);
  });

  // ---- 1c ------------------------------------------------------------------
  await phase(`${W}x${H} 1c`, async () => {
  await page.goto(`${BASE}/assessments?id=math-demo&tab=responses`, { waitUntil: "networkidle" });
  await panel.locator(".gbq-question").filter({ hasText: `Q${q2.number} ·` }).getByRole("button").click();
  const blankCard = panel.locator(".gbq-group").filter({ hasText: "(blank)" }).first();
  await blankCard.waitFor({ timeout: 10000 });
  const q2ids = saved().filter((r) => r.questionId === q2.id).map((r) => r.id);
  const row2 = blankCard.locator(".gbq-students li").nth(1);
  const name2 = (await row2.locator(".gbq-student-head > span").first().innerText()).trim();
  await row2.getByRole("button", { name: "Grade on their own" }).click();
  await page.waitForTimeout(600);
  check(!!saved().find((r) => r.questionId === q2.id && r.gradedAlone), `${W}x${H} 1c: the blank-read student is pulled out and saved as such`);
  const alone = saved().find((r) => r.questionId === q2.id && r.studentId === current.students.find((x) => x.name === name2)?.id);
  const aloneCard = await ownBox(panel, name2);
  check((await panel.locator(`[data-alone="${alone?.id}"]`).count()) === 1 && (await aloneCard.innerText()).includes("graded on their own"), `${W}x${H} 1c: they have their own card, named`);
  // Same credit for both: the pulled-out student first, then the group.
  await aloneCard.getByRole("button", { name: "No credit" }).click();
  await page.waitForTimeout(600);
  const groupCard = panel.locator(".gbq-group:not([data-alone])").filter({ hasText: "(blank)" }).first();
  await groupCard.locator(".gbq-credit").first().getByRole("button", { name: "No credit" }).click();
  await page.waitForTimeout(800);
  const q2now = saved().filter((r) => r.questionId === q2.id);
  check(q2now.every((r) => r.verified && r.match === 0), `${W}x${H} 1c: everyone on Q${q2.number} is graded at 0`);
  // Q2 is now fully graded, so the app has moved on to the next question with
  // work: go back to Q2 the way a teacher would.
  const openQ2 = async () => {
    const all = panel.getByRole("button", { name: "All questions" });
    if (await all.count()) await all.click();
    await panel.locator(".gbq-question").filter({ hasText: `Q${q2.number} ·` }).getByRole("button").click();
    await panel.locator(".gbq-group").first().waitFor({ timeout: 10000 });
  };
  await openQ2();
  const cards = await panel.locator(".gbq-group").count();
  check(cards === 2 && (await panel.locator(`[data-alone="${alone?.id}"]`).count()) === 1, `${W}x${H} 1c: same answer, same credit, still two cards (got ${cards})`);
  // Reload: still apart.
  await page.reload({ waitUntil: "networkidle" });
  await openQ2();
  check((await panel.locator(`[data-alone="${alone?.id}"]`).count()) === 1, `${W}x${H} 1c: after a reload, still their own card`);
  // "Change" on the group, full credit: the pulled-out student keeps 0.
  const group2 = panel.locator(".gbq-group:not([data-alone])").first();
  await group2.getByRole("button", { name: "Change" }).first().click();
  await group2.getByRole("button", { name: "Full credit" }).click();
  await page.waitForTimeout(800);
  await openQ2();
  const a2 = saved().find((r) => r.id === alone?.id);
  const rest = saved().filter((r) => r.questionId === q2.id && r.id !== alone?.id);
  check(a2.match === 0 && rest.every((r) => r.match === 100), `${W}x${H} 1c: "Change" on the group regraded the group only (pulled-out ${a2.match}, group ${[...new Set(rest.map((r) => r.match))]})`);
  // And the other way round: changing the pulled-out student leaves the group.
  // Half credit, so the result differs from the group's full credit.
  const aloneNow = panel.locator(`[data-alone="${alone?.id}"]`);
  await aloneNow.getByRole("button", { name: "Change" }).first().click();
  const worth = Number(await aloneNow.locator(".gbq-credit .cell-meta").first().innerText().then((t) => (t.match(/of ([\d.]+)/) || [])[1]));
  await aloneNow.locator("input[aria-label^='Points for the answer']").fill(String(worth / 2));
  await aloneNow.locator(".gbq-credit").getByRole("button", { name: /^Give/ }).click();
  await page.waitForTimeout(800);
  const mine = saved().find((r) => r.id === alone?.id).match;
  const theirs = [...new Set(saved().filter((r) => r.questionId === q2.id && r.id !== alone?.id).map((r) => r.match))];
  check(mine === 50 && theirs.length === 1 && theirs[0] === 100 && q2ids.length === saved().filter((r) => r.questionId === q2.id).length,
    `${W}x${H} 1c: regrading the pulled-out student changed only them (them ${mine}, group ${theirs})`);
  await page.screenshot({ path: join(OUT, `graded-alone-1c-${W}.png`) });
  });
  await ctx.close();
}
await browser.close();
console.log("=== GRADE ON THEIR OWN (1a, 1c) ===");
for (const p of pass) console.log("  OK   " + p);
for (const f of fail) console.log("  FAIL " + f);
console.log(`\n${pass.length}/${pass.length + fail.length} assertions passed`);
process.exit(fail.length ? 1 : 0);
