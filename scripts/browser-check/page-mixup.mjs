// Answers on the wrong paper (Michael, 2 Nov 2026), at 390x844 and 1366x768:
// two students whose answers are marked checkPages show "Answers may belong
// to another page — check" above Grade by question; "Move these answers to…"
// onto the other swaps their answers (the save carries it) and the marks
// clear; "Edit reading" corrects what an answer was read as. Demo data with
// placeholder names; /api/* mocked, the saved workspace captured.
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
  const a = w.assessments.find((x) => x.id === "math-demo");
  a.questions = a.questions.map((q) => ({ ...q, verified: true }));
  a.responses = a.responses.map((r) => (r.studentId === "s1" || r.studentId === "s2" ? { ...r, checkPages: true } : r));
  const s1 = w.students.find((s) => s.id === "s1").name;
  const s2 = w.students.find((s) => s.id === "s2").name;
  const before = (id) => a.responses.filter((r) => r.studentId === id).map((r) => r.questionId + "=" + r.answer).sort();
  let saved = null;
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route("**/api/workspace", (r) => {
    if (r.request().method() === "GET") return r.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }));
    saved = JSON.parse(r.request().postData() || "{}").workspace || saved;
    return r.fulfill(json({ revision: 8 }));
  });
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  await ctx.route("**/api/scans/session**", (r) => r.fulfill(json({ state: null, revision: 0 })));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  const sideScroll = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  try {
    await page.goto(`${BASE}/assessments?id=math-demo&tab=responses`, { waitUntil: "networkidle" });
    const panel = page.locator(".mixup-panel");
    await panel.waitFor({ timeout: 15000 });
    check((await panel.locator("h2").innerText()).includes("Check 2 students’ answers"), `${tag}: the two marked students are listed`);
    check((await panel.locator(".check-pages-tag").count()) === 2 && /Answers may belong to another page — check/.test(await panel.innerText()), `${tag}: each says "Answers may belong to another page — check"`);
    await panel.locator(".mixup-list li").first().getByRole("button", { name: "See pages" }).click();
    check(true, `${tag}: See pages opens`);
    check(!(await sideScroll()), `${tag}: nothing scrolls sideways`);
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(OUT, `page-mixup-${W}.png`), fullPage: false });
    await panel.locator(".mixup-list li").first().getByRole("button", { name: "Move these answers to…" }).click();
    const fromSel = panel.locator('select[aria-label="Move the answers of"]');
    const toSel = panel.locator('select[aria-label="Move them to"]');
    check((await fromSel.inputValue()) === "s1", `${tag}: the move starts from the marked student`);
    await toSel.selectOption("s2");
    const what = await panel.locator(".mixup-what").innerText();
    check(what.includes("swap answers"), `${tag}: onto a student with answers it says it is a swap ("${what}")`);
    await panel.getByRole("button", { name: "Swap answers" }).click();
    const ask = page.getByRole("alertdialog");
    await ask.waitFor({ timeout: 5000 });
    const askTitle = (await ask.locator("h2").innerText()).trim();
    check(askTitle === `Swap ${s1}’s 8 answers and ${s2}’s 8 answers?`, `${tag}: it asks first ("${askTitle}")`);
    check(!saved, `${tag}: and nothing is saved before the answer`);
    await ask.getByRole("button", { name: "Swap answers" }).click();
    await page.waitForTimeout(800);
    const after = (id) => saved.assessments.find((x) => x.id === "math-demo").responses.filter((r) => r.studentId === id).map((r) => r.questionId + "=" + r.answer).sort();
    check(!!saved && JSON.stringify(after("s1")) === JSON.stringify(before("s2")) && JSON.stringify(after("s2")) === JSON.stringify(before("s1")), `${tag}: the save swaps ${s1}'s and ${s2}'s answers`);
    check(!!saved && !saved.assessments.find((x) => x.id === "math-demo").responses.some((r) => r.checkPages), `${tag}: and the marks clear`);
    await page.locator(".mixup-panel.has-flags").waitFor({ state: "detached", timeout: 5000 }).then(() => check(true, `${tag}: the check list goes away`)).catch(() => check(false, `${tag}: the check list goes away`));
    const afterSwap = saved;
    const ids = (ws) => new Set(ws.assessments.find((x) => x.id === "math-demo").responses.filter((r) => r.studentId === "s1" || r.studentId === "s2").map((r) => r.id));
    const orig = new Set(a.responses.filter((r) => r.studentId === "s1" || r.studentId === "s2").map((r) => r.id));
    check([...ids(afterSwap)].every((id) => !orig.has(id)), `${tag}: the swapped answers carry new ids`);
    await page.getByRole("button", { name: "Undo" }).click();
    await page.waitForTimeout(800);
    check(saved !== afterSwap && JSON.stringify(after("s1")) === JSON.stringify(before("s1")) && JSON.stringify(after("s2")) === JSON.stringify(before("s2")), `${tag}: Undo puts them back`);
    // Edit reading, on question 1.
    await page.locator(".gbq-question").first().getByRole("button").last().click();
    const edit = page.getByRole("button", { name: "Edit reading" }).first();
    await edit.waitFor({ timeout: 8000 });
    await edit.click();
    const input = page.locator(".edit-written input");
    await input.fill("   ");
    check(await page.locator(".edit-written").getByRole("button", { name: "Save" }).isDisabled(), `${tag}: an empty reading cannot be saved`);
    await input.fill("fixed reading");
    await page.locator(".edit-written").getByRole("button", { name: "Save" }).click();
    await page.waitForTimeout(800);
    const edited = saved?.assessments.find((x) => x.id === "math-demo").responses.find((r) => r.answer === "fixed reading");
    check(!!edited && edited.finalAnswer === "fixed reading" && edited.gradedAlone === true && edited.verified === false, `${tag}: Edit reading saves it, on its own and undecided (nobody else wrote that)`);
    check(!(await sideScroll()), `${tag}: nothing scrolls sideways after`);
    check(errors.length === 0, `${tag}: no page errors ${errors.join(" | ")}`);
  } catch (e) {
    fail.push(`${tag}: stopped -- ${String(e.message || e).split("\n")[0]}`);
    await page.screenshot({ path: join(OUT, `page-mixup-FAILED-${W}.png`) });
  }
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
