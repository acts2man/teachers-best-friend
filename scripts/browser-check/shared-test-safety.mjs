// A test used by two classes (review of #202), at 390x844 and 1366x768. The
// demo test is shared with a second placeholder class, which is on screen and
// has no answers yet:
//   - Class analysis in that class is empty (the first class's graded answers
//     do not count here);
//   - editing a question says it changes it for both classes;
//   - Delete says "Used by 2 classes — deleting it deletes every class's
//     student work";
//   - "Remove from this class" takes it out of this class only: the save
//     keeps the test, in the first class, with every one of its answers.
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
  w.classes = [...w.classes.map((c) => ({ ...c, demo: false, gradingMode: "percentage" })), { id: "class-b", name: "Class B", grade: 4, framework: w.classes[0].framework, demo: false, gradingMode: "percentage" }];
  w.students = [...w.students, { id: "b-1", classId: "class-b", name: "Pupil One", color: "#888", evidence: [], notes: "" }];
  const a = w.assessments.find((x) => x.id === "math-demo");
  a.classIds = ["class-b"];
  a.questions = a.questions.map((q) => ({ ...q, verified: true }));
  const homeAnswers = a.responses.length;
  w.activeClassId = "class-b";
  let saved = null;
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route("**/api/workspace", (r) => {
    if (r.request().method() === "GET") return r.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }));
    saved = JSON.parse(r.request().postData() || "{}").workspace;
    return r.fulfill(json({ revision: 8 }));
  });
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  await ctx.route("**/api/scans/session**", (r) => r.fulfill(json({ state: null, revision: 0 })));
  await ctx.route("**/api/uploads/delete**", (r) => r.fulfill(json({ deleted: [], missing: [], failed: [], kept: [] })));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  try {
    await page.goto(`${BASE}/assessments?id=math-demo&tab=analysis`, { waitUntil: "networkidle" });
    await page.getByText("No graded responses yet").waitFor({ timeout: 15000 });
    check(true, `${tag}: Class analysis in Class B is empty -- The Explorers' graded answers are not counted here`);
    check(!(await page.getByText(/still need grading/).count()), `${tag}: and says nothing is "still being graded" for Class B`);
    // Edit a question.
    await page.getByRole("tab", { name: /Assessment review/ }).click();
    await page.locator("button.question-cell:visible").first().click();
    const sheet = page.locator(".review-sheet");
    await sheet.waitFor({ timeout: 8000 });
    const warn = (await sheet.locator(".shared-edit-warning").innerText()).replace(/\s+/g, " ");
    check(/used by 2 classes \(The Explorers, Class B\)\. A change here changes the question for all of them/.test(warn), `${tag}: editing a question says it changes it for both ("${warn.slice(0, 90)}…")`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    // Delete warns.
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    const del = (await page.getByRole("alertdialog").innerText()).replace(/\s+/g, " ");
    check(/Used by 2 classes \(The Explorers, Class B\) — deleting it deletes every class’s student work\./.test(del), `${tag}: Delete warns it deletes every class's work`);
    await page.getByRole("button", { name: "Keep assessment" }).click();
    await page.screenshot({ path: join(OUT, `shared-test-safety-${W}.png`) });
    // Remove from this class.
    await page.getByRole("button", { name: "Remove from this class" }).click();
    const rm = (await page.getByRole("alertdialog").innerText()).replace(/\s+/g, " ");
    check(/Remove “.+” from Class B\?/.test(rm) && /The Explorers keeps the test and all of its students’ work\./.test(rm), `${tag}: Remove says the other class keeps it ("${rm.slice(0, 140)}…")`);
    await page.getByRole("button", { name: "Remove from Class B" }).click();
    await page.waitForURL(/\/assessments$/, { timeout: 10000 });
    const t = saved?.assessments?.find((x) => x.id === "math-demo");
    check(!!t && t.classId === "demo" && !(t.classIds || []).includes("class-b"), `${tag}: the save takes it out of Class B only`);
    check(!!t && t.responses.length === homeAnswers, `${tag}: and keeps all ${homeAnswers} of The Explorers' answers (${t?.responses.length})`);
    check(errors.length === 0, `${tag}: no page errors ${errors.join(" | ")}`);
  } catch (e) {
    fail.push(`${tag}: stopped -- ${String(e.message || e).split("\n")[0]}`);
    await page.screenshot({ path: join(OUT, `shared-test-safety-FAILED-${W}.png`) });
  }
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
