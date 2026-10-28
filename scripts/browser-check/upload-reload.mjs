// Background upload follow-ups (review of #188, 28 Oct 2026), in the real
// in-app camera with Chromium's fake camera at 390x844 and 1366x768.
// Proven when:
//   reload       a page still uploading when the tab reloads is picked up,
//                retried at once and placed in its own student's pile;
//   dup          the same, when the other device already put that very file
//                in the pile: it is not placed twice;
//   otherFailed  a failed page on the other device (saved with the scan
//                session) blocks grading here until that device settles it.
// Only the network is stood in for (demo data, no AI spend).
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const CHROMIUM = process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pass = [];
const fail = [];
const check = (c, m) => (c ? pass : fail).push(m);

const browser = await chromium.launch({
  executablePath: CHROMIUM,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});


// One run: two camera students; student 2's upload hangs and the tab is
// reloaded while it is still going. `dup`: the other device already put that
// very file in student 2's pile, so recovering it must not place it twice.
// `otherFailed`: the account copy says the other device has a failed page.
async function run(W, H, mode) {
  const tag = `${W}x${H} ${mode}`;
  const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
  w.classes = w.classes.map((c) => ({ ...c, demo: false }));
  const a = w.assessments.find((x) => x.id === "ela-demo");
  const questionIds = a.questions.filter((q) => !q.excluded).map((q) => q.id);
  let uploads = 0;
  let hang = false;
  let recoverAs = null; // the upload id GET ?sha256 answers with, or null (not stored)
  const grading = [];
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, isMobile: W < 768, hasTouch: true, permissions: ["camera"] });
  await ctx.route("**/api/workspace", (r) =>
    r.request().method() === "GET"
      ? r.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }))
      : r.fulfill(json({ revision: 8 })),
  );
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 500, used: 0, remaining: 500, can_scan: true })));
  await ctx.route("**/api/uploads**", async (r) => {
    const req = r.request();
    if (req.method() === "GET" && req.url().includes("sha256=")) {
      return recoverAs ? r.fulfill(json({ id: recoverAs, name: "page.jpg", size: 90000, mime: "image/jpeg", pages: 1 })) : r.fulfill(json({ error: "none" }, 404));
    }
    if (req.method() !== "POST") return r.fulfill(json({}, 404));
    if (hang) return; // never answers: still uploading when the tab reloads
    uploads++;
    await sleep(200);
    return r.fulfill(json({ id: "upload-" + uploads, name: "page.jpg", size: 90000, mime: "image/jpeg", pages: 1 }));
  });
  await ctx.route("**/api/scans/reserve", (r) => r.fulfill(json({ charged: 5, alreadyPaid: 0, remaining: 400 })));
  await ctx.route("**/api/scans/release", (r) => r.fulfill(json({ ok: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  const remote = { state: null, revision: 0 };
  await ctx.route("**/api/scans/session**", (r) => {
    const m = r.request().method();
    if (m === "GET") return r.fulfill(json(remote));
    if (m === "PUT") {
      remote.state = JSON.parse(r.request().postData() || "{}").state ?? null;
      remote.revision++;
      return r.fulfill(json({ revision: remote.revision, ok: true }));
    }
    remote.state = null;
    remote.revision = 0;
    return r.fulfill(json({ ok: true }));
  });
  await ctx.route("**/api/analyze", async (r) => {
    const p = JSON.parse(r.request().postData() || "{}");
    if (p.mode === "name_strip")
      return r.fulfill(json({ model: "mock", result: { pages: p.uploadIds.map((_, i) => ({ page: i, name: "", confidence: 0, box: null })) } }));
    if (p.mode === "class_scan") {
      grading.push(p.pageGroups.map((g) => g.length));
      return r.fulfill(json({ model: "mock", result: { groups: p.pageGroups.map((_, k) => ({ group: k, responses: questionIds.map((questionId) => ({ questionId, answer: "demo", verdict: "other", finalAnswer: "demo" })) })) } }));
    }
    return r.fulfill(json({ error: "unexpected mode " + p.mode }, 400));
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  const shutter = page.locator("button.scan-camera-shutter");
  const shoot = async () => {
    const before = await page.locator(".scan-camera-thumb").count();
    for (let tries = 0; tries < 5; tries++) {
      await shutter.click({ timeout: 20000 });
      const keep = page.getByRole("button", { name: "Keep anyway" });
      if (await keep.waitFor({ timeout: 1500 }).then(() => true, () => false)) await keep.click();
      if (await page.waitForFunction((b) => document.querySelectorAll(".scan-camera-thumb").length > b, before, { timeout: 4000 }).then(() => true, () => false)) break;
    }
    await sleep(250);
  };
  const savedCopies = () =>
    page.evaluate(
      (id) =>
        new Promise((res) => {
          const open = indexedDB.open("tbf-scan-camera");
          open.onsuccess = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains("shots")) return res([]);
            const req = db.transaction("shots").objectStore("shots").index("assessmentId").getAll(id);
            req.onsuccess = () => res(req.result.map((s) => ({ sent: !!s.sent, failed: !!s.failed, pile: s.placeAt?.pile ?? null })));
            req.onerror = () => res(null);
          };
          open.onerror = () => res(null);
        }),
      "ela-demo",
    );
  const gradeButton = () => page.locator("button").filter({ hasText: /^Grade/ }).first();
  try {
    await page.goto(`${BASE}/assessments?id=ela-demo&tab=responses`, { waitUntil: "networkidle", timeout: 30000 });
    if (mode === "otherFailed") {
      // The phone has a failed page; this is the computer.
      remote.state = { v: 1, piles: [[{ key: "k1", label: "p", bodyId: "upload-x", stripId: null, pages: 1 }], []], progress: null, groups: null, discarded: [], pageUploadIds: [], grading: null, failed: { "the-phone": 1 } };
      remote.revision = 3;
      await page.reload({ waitUntil: "networkidle" });
      const notice = page.locator(".failed-pages-elsewhere");
      await notice.waitFor({ timeout: 20000 });
      const said = (await notice.innerText()).replace(/\s+/g, " ");
      check(said === "1 page didn't upload on your other device. Retry it there, or leave it out there, before grading.", `${tag}: the other device's failed page is shown here ("${said}")`);
      await gradeButton().click();
      await sleep(1500);
      check(grading.length === 0, `${tag}: and grading will not start (${grading.length} grading calls)`);
      // The phone leaves it out: its count goes to 0, and grading may start.
      remote.state = { ...remote.state, failed: {} };
      remote.revision++;
      await page.waitForFunction(() => !document.querySelector(".failed-pages-elsewhere"), null, { timeout: 25000 });
      await gradeButton().click();
      for (let t = 0; t < 100 && !grading.length; t++) await sleep(100);
      check(grading.length === 1, `${tag}: once the phone settles it, grading starts`);
      check(errors.length === 0, `${tag}: no page errors ${errors.join(" | ")}`);
      return;
    }
    await page.getByRole("button", { name: /Scan student work/ }).click();
    await page.waitForFunction(() => { const b = document.querySelector("button.scan-camera-shutter"); return b && !b.disabled; }, null, { timeout: 30000 });
    const autoBtn = page.locator("button[aria-pressed]", { hasText: "Auto" }).first();
    if ((await autoBtn.getAttribute("aria-pressed")) === "true") await autoBtn.click();
    await shoot();
    await page.getByRole("button", { name: /Next student/ }).click();
    for (let t = 0; t < 50 && uploads < 2; t++) await sleep(100); // body + name strip
    await shoot();
    hang = true;
    await page.getByRole("button", { name: /Next student/ }).click();
    await sleep(1500);
    let copies = await savedCopies();
    check(copies.length === 1 && copies[0].sent && !copies[0].failed && copies[0].pile === 1, `${tag}: student 2's page is uploading, its place saved (${JSON.stringify(copies)})`);
    // The tab reloads mid-upload. The next uploads answer.
    hang = false;
    if (mode === "dup") {
      // The other device already has this very file in student 2's pile.
      const st = remote.state;
      st.piles = [st.piles[0], [{ key: "dup", label: "scan-2-1.jpg", bodyId: "upload-dup", stripId: null, pages: 1 }]];
      remote.revision++;
      recoverAs = "upload-dup";
    }
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => !/Uploading/.test(document.body.innerText) && !document.querySelector(".failed-pages li"), null, { timeout: 30000 });
    await sleep(1500);
    copies = await savedCopies();
    check(copies?.length === 0, `${tag}: after the reload it was retried and landed; no copy left (${JSON.stringify(copies)})`);
    check((await page.getByRole("button", { name: /^Retry$/ }).count()) === 0, `${tag}: nothing waits with Retry`);
    await gradeButton().click();
    for (let t = 0; t < 100 && !grading.length; t++) await sleep(100);
    check(JSON.stringify(grading[0]) === "[1,1]", `${tag}: graded as two students of one page each -- ${mode === "dup" ? "the file once, not twice" : "in student 2's own pile"} (${JSON.stringify(grading[0])})`);
    check(errors.length === 0, `${tag}: no page errors ${errors.join(" | ")}`);
  } catch (e) {
    fail.push(`${tag}: stopped -- ${String(e.message || e).split("\n")[0]}`);
    await page.screenshot({ path: join(OUT, `upload-reload-FAILED-${W}-${mode}.png`) });
  }
  await ctx.close();
}

for (const [W, H] of [[390, 844], [1366, 768]]) for (const mode of ["reload", "dup", "otherFailed"]) await run(W, H, mode);
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
