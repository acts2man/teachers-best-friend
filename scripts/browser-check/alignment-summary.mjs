// Michael, 19 Oct 2026, in a browser at 390x844 and 1366x768.
//
// Proven when: an assessment whose nine questions the AI scored 82, 84, 86,
// 90, 96, 95, 96, 92, 90 -- the last five on W.4.3, outside its target
// standards -- shows "Standards alignment 90%" (it showed 38%) with the line
// "5 of 9 questions use standards outside your list", and the line is absent
// when every question is on the list. Seeded demo data with made-up questions;
// /api/* is mocked.
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const SHOTS = process.env.SHOTS || join(OUT, "alignment-summary");
const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const CHROMIUM = process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const pass = [];
const fail = [];
const check = (c, m) => (c ? pass : fail).push(m);
mkdirSync(SHOTS, { recursive: true });

const SCORES = [82, 84, 86, 90, 96, 95, 96, 92, 90];
const STANDARDS = ["RL.4.3", "RL.4.3", "RL.4.1", "RL.4.2", "W.4.3", "W.4.3", "W.4.3", "W.4.3", "W.4.3"];
function fixture(targets) {
  const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
  w.classes = w.classes.map((c) => ({ ...c, demo: false }));
  const a = w.assessments.find((x) => x.id === "ela-demo");
  const template = a.questions[0];
  a.title = "Story Organizer";
  a.targetStandards = targets;
  a.questions = SCORES.map((alignment, i) => ({
    ...template, id: "box" + (i + 1), number: i + 1, text: "Box " + (i + 1), standard: STANDARDS[i],
    alignment, verified: true, excluded: false, secondChoice: undefined, reasoning: "",
  }));
  a.responses = [];
  return w;
}

const browser = await chromium.launch({ executablePath: CHROMIUM });
for (const [W, H] of [[390, 844], [1366, 768]]) {
  const tag = `${W}x${H}`;
  for (const [label, targets, line] of [
    ["W.4.3 outside the list", ["RL.4.1", "RL.4.2", "RL.4.3"], "5 of 9 questions use standards outside your list"],
    ["every standard on the list", ["RL.4.1", "RL.4.2", "RL.4.3", "W.4.3"], null],
  ]) {
    const w = fixture(targets);
    const ctx = await browser.newContext({ viewport: { width: W, height: H } });
    await ctx.route("**/api/workspace", (r) =>
      r.request().method() === "GET"
        ? r.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }))
        : r.fulfill(json({ revision: 8 })),
    );
    await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
    await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
    await ctx.route("**/api/scans/session**", (r) => r.fulfill(json({ state: null, revision: 0 })));
    const page = await ctx.newPage();
    await page.goto(`${BASE}/assessments?id=ela-demo&tab=questions`, { waitUntil: "networkidle" });
    const bar = page.locator(".assignment-status-bar > div").first();
    await bar.waitFor({ timeout: 15000 });
    const value = (await bar.locator("strong").innerText()).trim();
    const text = (await bar.innerText()).replace(/\s+/g, " ");
    check(value === "90%", `${tag} ${label}: Standards alignment is 90% (shows ${value})`);
    check(line ? text.includes(line) : !/outside your list/.test(text), `${tag} ${label}: ${line ? `"${line}"` : "no off-list line"} (${text})`);
    const fits = await page.evaluate(() => {
      const b = document.querySelector(".assignment-status-bar");
      return document.documentElement.scrollWidth <= window.innerWidth + 1 && [...b.querySelectorAll("small, strong, span")].every((e) => e.getBoundingClientRect().right <= b.getBoundingClientRect().right + 1);
    });
    check(fits, `${tag} ${label}: the summary fits, no sideways scroll`);
    await page.locator(".assignment-status-bar").screenshot({ path: join(SHOTS, `${label.replace(/\W+/g, "-")}-${tag}.png`) });
    await ctx.close();
  }
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
