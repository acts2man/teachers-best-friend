// Ricky's new Math error list (24 Oct 2026), in a browser at 390x844 and
// 1366x768, on the grading screen (Grade by question). Proven when the Common
// error picker offers his eight, in order; choosing "Other (type your own)"
// shows a box; the typed label is saved as "Other: <label>" with the credit;
// after a reload the graded card shows it and the picker comes back as Other
// with the label in its box; and nothing scrolls sideways.
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
const RICKY = [
  "No error type", "Conceptual Gap", "Setup/Method Error", "Algebraic/Procedural Error", "Sign Error",
  "Graphing Error", "Data Interpretation Error", "Reasoning/Justification Error", "Other (type your own)",
];

function fixture() {
  const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
  w.classes = w.classes.map((c) => ({ ...c, demo: false }));
  const a = w.assessments.find((x) => x.id === "math-demo");
  const q1 = a.questions[0];
  a.responses = a.responses.map((r) => {
    if (r.questionId !== q1.id) return { ...r, verified: true };
    // Q1: every answer the same wrong one, so it is one group.
    return { ...r, answer: "236", finalAnswer: "236", correct: false, match: undefined, verified: false, confidence: 100, misconception: "", errorType: "", suggestedErrorType: "" };
  });
  return { w, q1 };
}

const browser = await chromium.launch({ executablePath: CHROMIUM });
for (const [W, H] of [[390, 844], [1366, 768]]) {
  const tag = `${W}x${H}`;
  const { w, q1 } = fixture();
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
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  const saved = () => current.assessments.find((x) => x.id === "math-demo").responses.filter((r) => r.questionId === q1.id);
  const panel = page.locator("#grade-by-question");
  const sideScroll = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  try {
    await page.goto(`${BASE}/assessments?id=math-demo&tab=responses`, { waitUntil: "networkidle" });
    await panel.getByRole("button", { name: /^Review/ }).first().click();
    const group = panel.locator(".gbq-group").first();
    await group.locator("input[aria-label^='Points for the answer']").waitFor({ timeout: 10000 });
    await group.getByRole("combobox", { name: "Common error" }).click();
    const options = (await page.getByRole("option").allInnerTexts()).map((t) => t.trim());
    check(JSON.stringify(options) === JSON.stringify(RICKY), `${tag}: the picker offers Ricky's eight, in order (${options.join(" | ")})`);
    await page.getByRole("option", { name: "Other (type your own)" }).click();
    const box = group.getByRole("textbox", { name: "Your own error label" });
    check(await box.waitFor({ timeout: 5000 }).then(() => true, () => false), `${tag}: choosing Other shows a box for the label`);
    await box.fill("forgot to carry");
    check(!(await sideScroll()), `${tag}: nothing scrolls sideways with the box open`);
    await page.screenshot({ path: join(OUT, `error-type-other-${W}.png`) });
    await group.locator("input[aria-label^='Points for the answer']").fill("0");
    await group.locator(".gbq-credit").first().getByRole("button", { name: /^Give/ }).click();
    await page.waitForTimeout(800);
    const tags = [...new Set(saved().map((r) => r.errorType))];
    check(JSON.stringify(tags) === JSON.stringify(["Other: forgot to carry"]), `${tag}: saved with the credit as "Other: <label>" (${JSON.stringify(tags)})`);
    // Reload (the app then opens the next step): back to Student work.
    await page.goto(`${BASE}/assessments?id=math-demo&tab=responses`, { waitUntil: "networkidle" });
    const all = panel.getByRole("button", { name: "All questions" });
    if (await all.count()) await all.click();
    await panel.locator(".gbq-question").filter({ hasText: `Q${q1.number} ·` }).getByRole("button").click();
    const after = panel.locator(".gbq-group").first();
    await after.waitFor({ timeout: 10000 });
    const decided = await after.locator(".grade-decided").innerText();
    check(/Other: forgot to carry/.test(decided), `${tag}: after a reload the graded card shows the label ("${decided.replace(/\s+/g, " ").trim()}")`);
    const pick = await after.getByRole("combobox", { name: "Common error" }).innerText();
    const kept = await after.getByRole("textbox", { name: "Your own error label" }).inputValue();
    check(/Other/.test(pick) && kept === "forgot to carry", `${tag}: and its picker is Other, with the label in the box ("${pick.trim()}", "${kept}")`);
    // Retag from the graded card: a different label is saved when the box is left.
    await after.getByRole("textbox", { name: "Your own error label" }).fill("misread the graph");
    await after.getByRole("textbox", { name: "Your own error label" }).press("Enter");
    await page.waitForTimeout(800);
    const retagged = [...new Set(saved().map((r) => r.errorType))];
    check(JSON.stringify(retagged) === JSON.stringify(["Other: misread the graph"]), `${tag}: retagging a graded group saves the new label (${JSON.stringify(retagged)})`);
    check(saved().every((r) => r.verified && r.match === 0), `${tag}: the grade is untouched by retagging`);
    check(errors.length === 0, `${tag}: no page errors ${errors.join(" | ")}`);
  } catch (e) {
    fail.push(`${tag}: stopped -- ${String(e.message || e).split("\n")[0]}`);
    await page.screenshot({ path: join(OUT, `error-type-other-FAILED-${W}.png`) });
  }
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
