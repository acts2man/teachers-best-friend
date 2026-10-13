// #125 follow-ups a and b (13 Oct), driven through the real class-scan screen
// with a whole stack uploaded at once (no declared piles), at 390x844 and
// 1366x768.
//
// a. Two pages in a row read the same first name only ("Maria", "Maria"): kept
//    as one student, and the matching screen offers "These are 2 different
//    students". One tap grades the two pages again, separately, and shows two
//    rows; the second is the teacher's to match before saving.
// b. A name read after a different student each time and not on the roster
//    ([Amelia R., Dee, Ivo, Dee, Pim, Dee]: one exact roster name, as in a
//    real class -- the old rule needed one to call anything a motto -- and
//    "Dee" on nobody's roster): each such page is its own row, matched
//    to nobody, and nothing saves until the teacher says whose each is.
//
// Only the network is stood in for (demo data, no AI spend). Names are
// placeholders.
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

async function makeJpegs(n) {
  const p = await browser.newPage();
  const urls = await p.evaluate((n) =>
    Array.from({ length: n }, (_, i) => {
      const c = document.createElement("canvas");
      c.width = 850;
      c.height = 1100;
      const g = c.getContext("2d");
      g.fillStyle = "#fff";
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = "#111";
      g.font = "40px sans-serif";
      g.fillText("Demo worksheet page " + (i + 1), 60, 120);
      return c.toDataURL("image/jpeg", 0.9);
    }), n);
  await p.close();
  return urls.map((u, i) => ({ name: `page-${i}.jpg`, mimeType: "image/jpeg", buffer: Buffer.from(u.split(",")[1], "base64") }));
}

/** Drives one stack through to the matching screen. `pageNames[i]` is what the
 * name pass reads on page i. Returns the page and what the app sent. */
async function scan(W, H, pageNames, label) {
  const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
  w.classes = w.classes.map((c) => ({ ...c, demo: false }));
  const a = w.assessments.find((x) => x.id === "ela-demo");
  const questionIds = a.questions.filter((q) => !q.excluded).map((q) => q.id);
  const sent = { classScans: [], saved: null };
  let uploads = 0;
  const stripOfPage = new Map();
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route("**/api/workspace", async (r) => {
    if (r.request().method() === "GET") return r.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }));
    sent.saved = JSON.parse(r.request().postData() || "{}");
    return r.fulfill(json({ revision: 8 }));
  });
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
  await ctx.route("**/api/uploads**", (r) => {
    if (r.request().method() !== "POST") return r.fulfill(json({}, 404));
    uploads++;
    // Uploads alternate page, strip: page k's strip is upload 2k+2.
    if (uploads % 2 === 0) stripOfPage.set("upload-" + uploads, uploads / 2 - 1);
    return r.fulfill(json({ id: "upload-" + uploads, name: "page.jpg", size: 120000, mime: "image/jpeg", pages: 1 }));
  });
  await ctx.route("**/api/scans/reserve", (r) => r.fulfill(json({ charged: pageNames.length, alreadyPaid: 0, remaining: 100 })));
  await ctx.route("**/api/scans/release", (r) => r.fulfill(json({ ok: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  await ctx.route("**/api/scans/session**", (r) => r.fulfill(json(r.request().method() === "GET" ? { state: null, revision: 0 } : { revision: 1, ok: true })));
  await ctx.route("**/api/analyze", async (r) => {
    const p = JSON.parse(r.request().postData() || "{}");
    if (p.mode === "name_strip")
      return r.fulfill(json({ model: "mock", result: { pages: p.uploadIds.map((id, i) => {
        const name = pageNames[stripOfPage.get(id)] ?? "";
        return { page: i, name, confidence: name ? 95 : 0, box: null };
      }) } }));
    if (p.mode === "class_scan") {
      sent.classScans.push(p.pageGroups.map((g) => g.length));
      return r.fulfill(json({ model: "mock", result: { groups: p.pageGroups.map((_, g) => ({
        group: g,
        responses: questionIds.map((questionId) => ({ questionId, answer: "demo answer", verdict: "other", finalAnswer: "demo" })),
      })) } }));
    }
    return r.fulfill(json({ error: "unexpected mode " + p.mode }, 400));
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  await page.goto(`${BASE}/assessments?id=ela-demo&tab=responses`, { waitUntil: "networkidle", timeout: 30000 });
  await page.locator('input[aria-label="Upload a whole stack of scanned student pages at once"]').setInputFiles(await makeJpegs(pageNames.length));
  await page.getByRole("button", { name: /Confirm & save/ }).waitFor({ timeout: 60000 });
  return { page, ctx, sent, errors, label };
}

const rows = (page) => page.locator(".name-match-row");
const save = (page) => page.getByRole("button", { name: /Confirm & save/ });

for (const [W, H] of [[390, 844], [1366, 768]]) {
  const tag = `${W}x${H}`;
  // ---- a ---------------------------------------------------------------
  try {
    const { page, ctx, sent, errors } = await scan(W, H, ["Maria", "Maria"], "a");
    check((await rows(page).count()) === 1, `${tag} a: "Maria", "Maria" is one student to start with (rows: ${await rows(page).count()})`);
    const split = page.getByRole("button", { name: "These are 2 different students" });
    check((await split.count()) === 1, `${tag} a: the split is offered`);
    await rows(page).first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(OUT, `name-split-offered-${W}.png`) });
    await split.click();
    await page.getByText("Split into two students").first().waitFor({ timeout: 15000 }).catch(() => {});
    check(JSON.stringify(sent.classScans) === JSON.stringify([[2], [1, 1]]), `${tag} a: graded once as one, then once more as two (${JSON.stringify(sent.classScans)})`);
    check((await rows(page).count()) === 2, `${tag} a: two rows after the split`);
    check(await save(page).isDisabled(), `${tag} a: nothing saves until the second is matched`);
    await rows(page).first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(OUT, `name-split-after-${W}.png`) });
    // The second row: "Add as a new student".
    const second = rows(page).nth(1);
    await second.locator("button[role=combobox], [role=combobox]").first().click();
    await page.getByRole("option", { name: "Add as a new student" }).click();
    check(!(await save(page).isDisabled()), `${tag} a: matched, it can be saved`);
    check(errors.length === 0, `${tag} a: no page errors ${errors.join(" | ")}`);
    await ctx.close();
  } catch (e) {
    fail.push(`${tag} a: stopped -- ${String(e.message || e).split("\n")[0]}`);
  }
  // ---- b ---------------------------------------------------------------
  try {
    const { page, ctx, errors } = await scan(W, H, ["Amelia R.", "Dee", "Ivo", "Dee", "Pim", "Dee"], "b");
    check((await rows(page).count()) === 6, `${tag} b: six rows, none folded into another (${await rows(page).count()})`);
    const dee = rows(page).filter({ hasText: "“Dee” was read on several papers" });
    check((await dee.count()) === 3, `${tag} b: each "Dee" page is its own row, marked for the teacher (${await dee.count()})`);
    check(await save(page).isDisabled(), `${tag} b: nothing saves until the teacher says whose each is`);
    await rows(page).first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(OUT, `name-repeated-${W}.png`) });
    for (let i = 0; i < 3; i++) {
      const row = rows(page).filter({ hasText: "“Dee” was read on several papers" }).first();
      await row.locator("[role=combobox]").first().click();
      await page.getByRole("option", { name: "Add as a new student" }).click();
    }
    check(!(await save(page).isDisabled()), `${tag} b: once each is chosen, it can be saved`);
    check(errors.length === 0, `${tag} b: no page errors ${errors.join(" | ")}`);
    await ctx.close();
  } catch (e) {
    fail.push(`${tag} b: stopped -- ${String(e.message || e).split("\n")[0]}`);
  }
}
await browser.close();
console.log("=== SAME-NAME SPLIT (a) AND REPEATED NAMES (b) ===");
for (const p of pass) console.log("  OK   " + p);
for (const f of fail) console.log("  FAIL " + f);
console.log(`\n${pass.length}/${pass.length + fail.length} assertions passed`);
process.exit(fail.length ? 1 : 0);
