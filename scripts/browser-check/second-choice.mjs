// #129 round 3, in a browser at 390x844 and 1366x768.
//
// 2a. The AI's unchecked second-choice standard used to count toward the
//     assessment's "Standards alignment" at a made-up 60%, and kept it once
//     confirmed. Proven when: it is left out of the average, and confirming it
//     gives no made-up score ("You chose it", like any standard the teacher
//     picks).
// 2b. The mark used to be text at the start of the editable reasoning:
//     deleting that text and pressing "Looks good — confirm all" confirmed the
//     guess. Proven when: with the text gone, "confirm all" still leaves it.
// Seeded demo data only; /api/* is mocked and every save is kept.
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
  a.status = "Needs review";
  a.questions = a.questions.map((q, i) =>
    i === 1
      ? // What a read now saves for a second choice: the mark in its own field,
        // no score -- and the explanation deleted from the reasoning by the
        // teacher (2b), so only the field says it is a guess.
        { ...q, verified: false, secondChoice: true, alignment: 0, confidence: 50, reasoning: "Rewritten by the teacher." }
      : i === 2
        ? // An ordinary unconfirmed question "confirm all" should take.
          { ...q, verified: false }
        : { ...q, verified: true },
  );
  // The average the header should show: AI-scored questions only, the second
  // choice left out (an off-target standard counts as 0, as the app does).
  const scored = a.questions.filter((q) => !q.excluded && q.alignment > 0);
  const expected = scored.length
    ? Math.round(scored.reduce((s, q) => s + (a.targetStandards.length && !a.targetStandards.includes(q.standard) ? 0 : q.alignment), 0) / scored.length)
    : null;
  // What it showed before the fix: the second choice in, at 60 (capped from 50
  // when the read had no score).
  const withGuess = [...scored, { ...a.questions[1], alignment: 50 }];
  const before = Math.round(withGuess.reduce((s, q) => s + (a.targetStandards.length && !a.targetStandards.includes(q.standard) ? 0 : q.alignment), 0) / withGuess.length);
  return { w, a, expected, before };
}

const browser = await chromium.launch({ executablePath: CHROMIUM });
for (const [W, H] of [[390, 844], [1366, 768]]) {
  const { w, a, expected, before } = fixture();
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
  const saved = () => current.assessments.find((x) => x.id === "math-demo").questions;
  await page.goto(`${BASE}/assessments?id=math-demo&tab=questions`, { waitUntil: "networkidle" });
  const header = async () => (await page.locator(".assignment-status-bar strong").first().innerText()).trim();

  // 2a: the average leaves the guess out.
  check((await header()) === (expected === null ? "—" : expected + "%"), `${W}x${H} 2a: "Standards alignment" is ${expected}% without the guess (shows ${await header()}; with it, it was ${before}%)`);
  const body = await page.locator("body").innerText();
  check(!/null%|NaN%/.test(body), `${W}x${H} 2a: no "null%" or "NaN%" anywhere`);
  const badges = [];
  for (const l of await page.getByText(/2nd choice — check/).all()) if (await l.isVisible()) badges.push((await l.innerText()).trim());
  check(badges.length >= 1, `${W}x${H}: the guess is labelled "AI's 2nd choice — check" (${JSON.stringify(badges)})`);
  check(badges.some((t) => /Not scored/.test(t)) || (await page.getByText("Not scored").filter({ visible: true }).count()) > 0, `${W}x${H} 2a: and shown as not scored, not as a percentage`);
  await page.screenshot({ path: join(OUT, `second-choice-${W}.png`) });

  // 2b: "Looks good — confirm all" with the note gone from the reasoning.
  await page.getByRole("button", { name: /Looks good — confirm all/ }).click();
  await page.waitForTimeout(800);
  const q = saved();
  check(q[2].verified === true, `${W}x${H} 2b: "confirm all" confirmed the ordinary question`);
  check(q[1].verified === false && q[1].secondChoice === true, `${W}x${H} 2b: and left the second choice for the teacher, though its reasoning no longer says so`);
  check((await page.getByText(/2nd choice — check/).filter({ visible: true }).count()) >= 1, `${W}x${H} 2b: still labelled on screen`);

  // 2a: the teacher confirms it -- no made-up score. (On the build before the
  // fix "confirm all" already took it, so there is nothing left to confirm:
  // reported as a failure, not a crash.)
  try {
    await page.getByText(a.questions[1].text.slice(0, 30)).first().click();
    await page.getByRole("button", { name: /Accept & save decision/ }).click({ timeout: 8000 });
    await page.waitForTimeout(800);
    const c = saved()[1];
    check(c.verified === true && c.secondChoice === undefined && c.alignment === 0, `${W}x${H} 2a: confirmed, it is the teacher's pick: mark gone, alignment ${c.alignment} (not 60)`);
    check((await header()) === (expected === null ? "—" : expected + "%"), `${W}x${H} 2a: the average is unchanged by confirming it (${await header()})`);
    check((await page.getByText(/2nd choice — check/).filter({ visible: true }).count()) === 0, `${W}x${H}: the label is gone`);
  } catch (e) {
    check(false, `${W}x${H} 2a: confirming the second choice -- stopped: ${String(e.message).split("\n")[0]}`);
  }
  await ctx.close();
}
await browser.close();
console.log("=== SECOND-CHOICE STANDARDS (2a, 2b) ===");
for (const p of pass) console.log("  OK   " + p);
for (const f of fail) console.log("  FAIL " + f);
console.log(`\n${pass.length}/${pass.length + fail.length} assertions passed`);
process.exit(fail.length ? 1 : 0);
