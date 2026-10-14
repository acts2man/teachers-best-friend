// "Replace writing" on an essay whose trait scores the teacher confirmed (G18).
// It used to drop them with no question. It now asks -- keep my confirmed
// scores / replace with new scores / cancel, with the count -- before
// anything is uploaded, and Keep or Replace then opens the file picker. That
// last step (a file picker opened from inside a dialog button) is what the
// module tests cannot see, so this drives the real screen at 390x844,
// 412x915 and 1366x768:
//
//   cancel  -> no file picker, nothing uploaded, nothing saved
//   keep    -> file picker opens; the save keeps the confirmed scores
//   replace -> file picker opens; the save carries the new, unconfirmed scores
//
// Only the network is stood in for (demo data, no AI spend). Needs
// out/fixture.json (make-fixture.mjs) and a running build (see README).
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
const TRAITS = ["trait-ideas", "trait-conv"];

async function open(W, H) {
  const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
  w.classes = w.classes.map((c) => ({ ...c, demo: false }));
  const a = w.assessments.find((x) => x.id === "math-demo");
  // The demo test made a writing assessment, every essay scored 3 and confirmed.
  const rubric = TRAITS.map((id, i) => ({ id, name: i ? "Conventions" : "Ideas", max: 4, descriptor: "Demo descriptor", standard: a.questions[0].standard }));
  const ids = [...new Set(a.responses.map((r) => r.studentId))];
  Object.assign(a, { subject: "ELA", elaArea: "writing", genre: "narrative", rubric, questions: [], assignmentUploadIds: [], uploadIds: [] });
  a.responses = ids.flatMap((studentId) => rubric.map((d) => ({ id: studentId + d.id, studentId, questionId: d.id, answer: "", correct: false, match: 75, rubricScore: 3, misconception: "", confidence: 90, verified: true })));
  const sent = { uploads: 0, analyze: 0, saved: null };
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route("**/api/workspace", async (r) => {
    if (r.request().method() === "GET") return r.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }));
    sent.saved = JSON.parse(r.request().postData() || "{}");
    return r.fulfill(json({ revision: 8 }));
  });
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
  await ctx.route("**/api/uploads**", (r) => {
    if (r.request().method() !== "POST") return r.fulfill(json({}, 404));
    sent.uploads++;
    return r.fulfill(json({ id: "upload-new-" + sent.uploads, name: "page.jpg", size: 1200, mime: "image/jpeg", pages: 1 }));
  });
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  await ctx.route("**/api/analyze", async (r) => {
    sent.analyze++;
    const body = JSON.parse(r.request().postData() || "{}");
    const responses = TRAITS.map((questionId) => ({ id: "new-" + questionId, studentId: body.studentId, questionId, answer: "", correct: false, match: 25, rubricScore: 1, misconception: "Demo reason", confidence: 80, verified: false }));
    return r.fulfill(json({ model: "mock", result: { responses } }));
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  await page.goto(BASE + "/assessments?id=math-demo", { waitUntil: "networkidle", timeout: 30000 });
  await page.getByRole("tab", { name: "2. Student writing" }).click();
  const btn = page.getByRole("button", { name: "Replace writing" });
  await btn.waitFor({ timeout: 15000 });
  await btn.scrollIntoViewIfNeeded();
  return { page, ctx, sent, errors, btn };
}

const dialog = (page) => page.getByRole("alertdialog");
const savedRows = (sent) => sent.saved?.workspace?.assessments?.find((x) => x.id === "math-demo")?.responses ?? [];

/** Press "Replace writing", choose, and hand the picker a page if it opens. */
async function choose(s, button) {
  await s.btn.click();
  await dialog(s.page).waitFor({ timeout: 5000 });
  const chooser = s.page.waitForEvent("filechooser", { timeout: 4000 }).catch(() => null);
  await dialog(s.page).getByRole("button", { name: button }).click();
  return chooser;
}

for (const [W, H] of [[390, 844], [412, 915], [1366, 768]]) {
  const tag = `${W}x${H}`;
  try {
    const s = await open(W, H);
    // The question, with the count.
    await s.btn.click();
    const d = dialog(s.page);
    await d.waitFor({ timeout: 5000 }).catch(() => {});
    const shown = await d.isVisible();
    check(shown, `${tag}: "Replace writing" asks before anything is uploaded (before: silent)`);
    if (shown) {
      const text = await d.innerText();
      check(text.includes("Replace 2 confirmed trait scores?"), `${tag}: it says how many confirmed scores ("Replace 2 confirmed trait scores?")`);
      check(["Keep my confirmed scores", "Replace with new scores", "Cancel"].every((t) => text.includes(t)), `${tag}: Keep / Replace / Cancel`);
      await s.page.waitForTimeout(500);
      await s.page.screenshot({ path: join(OUT, `writing-replace-${tag}.png`) });
      // Cancel.
      const picker = s.page.waitForEvent("filechooser", { timeout: 1500 }).catch(() => null);
      await d.getByRole("button", { name: "Cancel" }).click();
      check((await picker) === null && s.sent.uploads === 0 && s.sent.saved === null, `${tag}: Cancel opens no file picker, uploads and saves nothing`);
    }
    check(s.errors.length === 0, `${tag}: no page errors ${s.errors.join(" | ")}`);
    await s.ctx.close();
  } catch (e) {
    fail.push(`${tag} cancel: stopped -- ${String(e.message || e).split("\n")[0]}`);
  }
  for (const [button, keeps] of [["Keep my confirmed scores", true], ["Replace with new scores", false]]) {
    const label = keeps ? "Keep" : "Replace";
    try {
      const s = await open(W, H);
      const chooser = await choose(s, button);
      check(!!chooser, `${tag}: ${label} opens the file picker`);
      if (!chooser) {
        await s.ctx.close();
        continue;
      }
      await chooser.setFiles({ name: "essay.jpg", mimeType: "image/jpeg", buffer: JPEG });
      await s.page.waitForFunction(() => document.body.innerText.includes("Suggested scores ready"), null, { timeout: 15000 }).catch(() => {});
      await s.page.waitForTimeout(500);
      const changed = savedRows(s.sent).filter((r) => r.rubricScore === 1);
      const confirmed = savedRows(s.sent).filter((r) => r.verified && r.rubricScore === 3);
      check(s.sent.uploads === 1 && s.sent.analyze === 1 && !!s.sent.saved, `${tag}: ${label} uploads, scores and saves (uploads ${s.sent.uploads}, scored ${s.sent.analyze})`);
      if (keeps) check(changed.length === 0 && confirmed.length === savedRows(s.sent).length, `${tag}: Keep saves every confirmed score as it was (${confirmed.length}/${savedRows(s.sent).length})`);
      else check(changed.length === 2 && changed.every((r) => !r.verified), `${tag}: Replace saves the student's 2 traits as new, unconfirmed scores (${changed.length})`);
      check(s.errors.length === 0, `${tag} ${label}: no page errors ${s.errors.join(" | ")}`);
      await s.ctx.close();
    } catch (e) {
      fail.push(`${tag} ${label}: stopped -- ${String(e.message || e).split("\n")[0]}`);
    }
  }
}
await browser.close();
console.log("=== REPLACE WRITING ===");
for (const p of pass) console.log("  OK   " + p);
for (const f of fail) console.log("  FAIL " + f);
console.log(`\n${pass.length}/${pass.length + fail.length} assertions passed`);
process.exit(fail.length ? 1 : 0);
