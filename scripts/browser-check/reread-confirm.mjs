// Re-reading a test that already has graded answers clears them (the questions
// are replaced, so the answers have nothing to belong to). On 13 Oct a pilot
// teacher re-read a test and its 10 graded answers went without a word. Every
// re-read now stops first, says how many grades go, and cancelling keeps
// everything. Driven through the real screens at 390x844, 412x915 and
// 1366x768:
//
//   A. "Read document again" on the assessment page
//   B. "Read it again" on the scan screen when revising an existing test
//   C. "Save assessment" on the scan screen (no AI connection) when revising
//   D. a test with no graded answers re-reads straight away, no extra step
//   W. "Save writing assessment" on a writing assessment whose essays are
//      scored (it rebuilds the assessment, so the scores would go)
//
// Only the network is stood in for (demo data, no AI spend).
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

const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);

async function open(W, H, url, { aiReady = true, emptyResponses = false, writing = false } = {}) {
  const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
  w.classes = w.classes.map((c) => ({ ...c, demo: false }));
  const a = w.assessments.find((x) => x.id === "math-demo");
  a.assignmentUploadIds = ["doc-1"];
  a.uploadIds = [...new Set([...(a.uploadIds || []), "doc-1"])];
  if (emptyResponses) a.responses = [];
  if (writing) {
    // The same demo test, made a writing assessment with every essay scored.
    const rubric = [
      { id: "trait-ideas", name: "Ideas", max: 4, descriptor: "Demo descriptor", standard: a.questions[0].standard },
      { id: "trait-conv", name: "Conventions", max: 4, descriptor: "Demo descriptor", standard: a.questions[0].standard },
    ];
    const ids = [...new Set(a.responses.map((r) => r.studentId))];
    Object.assign(a, { subject: "ELA", elaArea: "writing", genre: "narrative", rubric, questions: [], assignmentUploadIds: [], uploadIds: [] });
    a.responses = ids.flatMap((studentId) => rubric.map((d) => ({ id: studentId + d.id, studentId, questionId: d.id, answer: "", correct: true, match: 75, rubricScore: 3, misconception: "", confidence: 90, verified: true })));
  }
  const before = a.responses.length;
  const students = new Set(a.responses.map((r) => r.studentId)).size;
  const sent = { analyze: 0, saved: null };
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route("**/api/workspace", async (r) => {
    if (r.request().method() === "GET") return r.fulfill(json({ workspace: w, revision: 7, aiReady, authProvider: "supabase", impersonating: null }));
    sent.saved = JSON.parse(r.request().postData() || "{}");
    return r.fulfill(json({ revision: 8 }));
  });
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
  await ctx.route("**/api/uploads**", (r) =>
    r.request().method() === "POST"
      ? r.fulfill(json({ id: "upload-new", name: "page.jpg", size: 1200, mime: "image/jpeg", pages: 1 }))
      : r.fulfill(json({}, 404)),
  );
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  await ctx.route("**/api/analyze", async (r) => {
    sent.analyze++;
    const q = (n) => ({ id: "new-q" + n, number: n, text: "Demo question " + n, passage: "", answer: "", standard: a.questions[0].standard, secondary: "", skill: "", dok: 1, alignment: 90, confidence: 95, level: "On grade", reasoning: "", verified: false, excluded: false });
    return r.fulfill(json({ model: "mock", result: { title: a.title, questions: [q(1), q(2)] } }));
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  await page.goto(BASE + url, { waitUntil: "networkidle", timeout: 30000 });
  return { page, ctx, sent, errors, before, students };
}

const savedResponses = (sent) => sent.saved?.workspace?.assessments?.find((x) => x.id === "math-demo")?.responses?.length;
const dialog = (page) => page.getByRole("alertdialog");

/** Press, cancel, check nothing happened; press again, confirm, check the read. */
async function cancelThenConfirm(tag, label, s, press, { reads = true } = {}) {
  const { page, sent, before, students } = s;
  await press();
  const d = dialog(page);
  await d.waitFor({ timeout: 5000 }).catch(() => {});
  const shown = await d.isVisible();
  check(shown, `${tag} ${label}: a confirm step appears before anything is read (before: silent)`);
  if (!shown) {
    await page.waitForTimeout(1500);
    check(false, `${tag} ${label}: (without it) ${sent.analyze} read(s) ran and the save kept ${savedResponses(sent) ?? "?"} of ${before} graded answers`);
    return;
  }
  const text = await d.innerText();
  const title = label === "W" ? `Clear the essay scores for ${students} students?` : `Clear ${before} graded answers?`;
  check(text.includes(title) && text.includes(`${students} students`), `${tag} ${label}: it says how many grades go ("${title}")`);
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, `reread-confirm-${label}-${tag}.png`) });
  await d.getByRole("button", { name: "Keep my grades" }).click();
  await d.waitFor({ state: "hidden", timeout: 5000 });
  await page.waitForTimeout(500);
  check(sent.analyze === 0 && sent.saved === null, `${tag} ${label}: cancelling reads nothing and saves nothing (reads ${sent.analyze}, saved ${sent.saved ? "yes" : "no"})`);
  await press();
  await dialog(page).getByRole("button", { name: /^Clear grades and (read again|save)$/ }).click();
  await page.waitForTimeout(2500);
  check(sent.analyze === (reads ? 1 : 0), `${tag} ${label}: confirming goes ahead (${sent.analyze} read)`);
  check(savedResponses(sent) === 0, `${tag} ${label}: and the save then clears them, as the step said (${savedResponses(sent)})`);
}

for (const [W, H] of [[390, 844], [412, 915], [1366, 768]]) {
  const tag = `${W}x${H}`;
  // A
  try {
    const s = await open(W, H, "/assessments?id=math-demo");
    const btn = s.page.getByRole("button", { name: "Read document again" });
    await btn.scrollIntoViewIfNeeded();
    await cancelThenConfirm(tag, "A", s, () => btn.click());
    check(s.errors.length === 0, `${tag} A: no page errors ${s.errors.join(" | ")}`);
    await s.ctx.close();
  } catch (e) {
    fail.push(`${tag} A: stopped -- ${String(e.message || e).split("\n")[0]}`);
  }
  // B
  try {
    const s = await open(W, H, "/scan?assessment=math-demo");
    await s.page.getByRole("button", { name: "Continue to upload" }).click();
    await s.page.locator('input[aria-label="Choose work to upload"]').setInputFiles({ name: "revision.jpg", mimeType: "image/jpeg", buffer: JPEG });
    const btn = s.page.getByRole("button", { name: /Read it again/ });
    await btn.waitFor({ timeout: 15000 });
    await s.page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /Read it again/.test(b.textContent) && !b.disabled), null, { timeout: 15000 });
    await btn.scrollIntoViewIfNeeded();
    await cancelThenConfirm(tag, "B", s, () => btn.click());
    check(s.errors.length === 0, `${tag} B: no page errors ${s.errors.join(" | ")}`);
    await s.ctx.close();
  } catch (e) {
    fail.push(`${tag} B: stopped -- ${String(e.message || e).split("\n")[0]}`);
  }
  // C
  try {
    const s = await open(W, H, "/scan?assessment=math-demo", { aiReady: false });
    await s.page.getByRole("button", { name: "Continue to upload" }).click();
    await s.page.locator('input[aria-label="Choose work to upload"]').setInputFiles({ name: "revision.jpg", mimeType: "image/jpeg", buffer: JPEG });
    const btn = s.page.getByRole("button", { name: /Save assessment/ });
    await s.page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /Save assessment/.test(b.textContent) && !b.disabled), null, { timeout: 15000 });
    await btn.scrollIntoViewIfNeeded();
    await cancelThenConfirm(tag, "C", s, () => btn.click(), { reads: false });
    check(s.errors.length === 0, `${tag} C: no page errors ${s.errors.join(" | ")}`);
    await s.ctx.close();
  } catch (e) {
    fail.push(`${tag} C: stopped -- ${String(e.message || e).split("\n")[0]}`);
  }
  // W
  try {
    const s = await open(W, H, "/scan?assessment=math-demo", { writing: true });
    const btn = s.page.getByRole("button", { name: /Save writing assessment/ });
    await btn.waitFor({ timeout: 15000 });
    await btn.scrollIntoViewIfNeeded();
    await cancelThenConfirm(tag, "W", s, () => btn.click(), { reads: false });
    check(s.errors.length === 0, `${tag} W: no page errors ${s.errors.join(" | ")}`);
    await s.ctx.close();
  } catch (e) {
    fail.push(`${tag} W: stopped -- ${String(e.message || e).split("\n")[0]}`);
  }
  // D
  try {
    const s = await open(W, H, "/assessments?id=math-demo", { emptyResponses: true });
    await s.page.getByRole("button", { name: "Read document again" }).click();
    await s.page.waitForTimeout(2000);
    check(!(await dialog(s.page).isVisible()) && s.sent.analyze === 1, `${tag} D: with no graded answers it reads straight away (reads ${s.sent.analyze})`);
    await s.ctx.close();
  } catch (e) {
    fail.push(`${tag} D: stopped -- ${String(e.message || e).split("\n")[0]}`);
  }
}
await browser.close();
console.log("=== RE-READ CONFIRM ===");
for (const p of pass) console.log("  OK   " + p);
for (const f of fail) console.log("  FAIL " + f);
console.log(`\n${pass.length}/${pass.length + fail.length} assertions passed`);
process.exit(fail.length ? 1 : 0);
