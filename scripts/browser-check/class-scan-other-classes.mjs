// The original case for the 12 Oct 2026 data loss, driven through the real
// class-scan screen: a teacher with TWO classes imports a class set into one of
// them, grades it, confirms the names and saves. Before the fix that save wrote
// only the active class's students, and sync_workspace deleted the rest.
//
// The page, the scan panel, the photo import, the batching, the name matching
// and the save are all the real app. Only the network is stood in for: the
// workspace, uploads, the credit reservation and the two AI calls answer with
// fixed demo data (no student data, no AI spend). The assertion is on the body
// the app actually PUTs to /api/workspace -- that body is what sync_workspace
// would apply.
//
//   node scripts/browser-check/make-fixture.mjs
//   node scripts/browser-check/class-scan-other-classes.mjs
//
// VIEWPORTS="390x844,412x915,1366x768" by default; screenshots land in out/.
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const CHROMIUM = process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const VIEWPORTS = (process.env.VIEWPORTS || "390x844,412x915,1366x768")
  .split(",")
  .map((v) => v.split("x").map(Number));

function fixture() {
  const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
  // A real teacher's classroom, not the sample one, plus a second class with
  // its own students -- the shape that lost its students.
  w.classes = w.classes.map((c) => ({ ...c, demo: false }));
  w.classes.push({ id: "period-2", name: "Period 2", grade: w.classes[0].grade, framework: w.classes[0].framework, demo: false });
  for (const [i, name] of ["Alexandria Montgomery-Fitzgerald", "Bartholomew Okonkwo-Reyes", "Guadalupe Villanueva Castillo"].entries())
    w.students.push({ id: "p2-student-" + i, classId: "period-2", name, color: "#4f6bed", evidence: [], notes: "" });
  w.activeClassId = w.classes[0].id;
  return w;
}

const pass = [];
const fail = [];
const check = (cond, msg) => (cond ? pass : fail).push(msg);

const browser = await chromium.launch({ executablePath: CHROMIUM });

// Four real JPEGs (a white page with a heading), made by the browser itself so
// the app's straighten-and-split step decodes them like a phone photo.
async function makeJpegs() {
  const p = await browser.newPage();
  const urls = await p.evaluate(() =>
    [0, 1, 2, 3].map((i) => {
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
    }),
  );
  await p.close();
  return urls.map((u, i) => ({ name: `page-${i}.jpg`, mimeType: "image/jpeg", buffer: Buffer.from(u.split(",")[1], "base64") }));
}
const files = await makeJpegs();

for (const [width, height] of VIEWPORTS) {
  const w = fixture();
  const before = w.students.map((s) => s.id);
  const otherClass = w.students.filter((s) => s.classId !== w.activeClassId).map((s) => s.id);
  const active = w.students.filter((s) => s.classId === w.activeClassId);
  const a = w.assessments.find((x) => x.id === "ela-demo");
  const questionIds = a.questions.filter((q) => !q.excluded).map((q) => q.id);
  let saved = null;
  let uploads = 0;

  const ctx = await browser.newContext({ viewport: { width, height } });
  const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
  await ctx.route("**/api/workspace", async (r) => {
    if (r.request().method() === "GET")
      return r.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }));
    saved = JSON.parse(r.request().postData() || "{}");
    return r.fulfill(json({ revision: 8 }));
  });
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
  await ctx.route("**/api/uploads**", (r) => {
    if (r.request().method() !== "POST") return r.fulfill(json({}, 404));
    uploads++;
    return r.fulfill(json({ id: "upload-" + uploads, name: "page.jpg", size: 120000, mime: "image/jpeg", pages: 1 }));
  });
  await ctx.route("**/api/scans/reserve", (r) => r.fulfill(json({ charged: 4, alreadyPaid: 0, remaining: 126 })));
  await ctx.route("**/api/scans/release", (r) => r.fulfill(json({ ok: true })));
  await ctx.route("**/api/scans/session**", (r) =>
    r.fulfill(json(r.request().method() === "GET" ? { state: null, revision: 0 } : { revision: 1, ok: true })));
  await ctx.route("**/api/analyze", async (r) => {
    const p = JSON.parse(r.request().postData() || "{}");
    if (p.mode === "name_strip")
      // Page 0 carries an active-class student's exact name; page 2 a name that
      // is on nobody's roster, so the save also creates a student.
      return r.fulfill(json({ model: "mock", result: { pages: p.uploadIds.map((_, i) => ({
        page: i,
        name: i === 0 ? active[0].name : i === 2 ? "Maximiliano Delacroix-Whitfield" : "",
        confidence: i % 2 === 0 ? 96 : 0,
        box: null,
      })) } }));
    if (p.mode === "class_scan")
      return r.fulfill(json({ model: "mock", result: { groups: p.pageGroups.map((_, g) => ({
        group: g,
        responses: questionIds.map((questionId) => ({ questionId, answer: "demo answer", verdict: "other", finalAnswer: "demo" })),
      })) } }));
    return r.fulfill(json({ error: "unexpected mode " + p.mode }, 400));
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  const tag = `${width}x${height}`;
  try {
    await page.goto(`${BASE}/assessments?id=ela-demo&tab=responses`, { waitUntil: "networkidle", timeout: 30000 });
    await page.locator('input[aria-label="Import a roll of photos of the whole class"]').setInputFiles(files);
    await page.getByRole("button", { name: /Import 2 students/i }).click({ timeout: 10000 });
    await page.getByRole("button", { name: /^Grade/i }).first().click({ timeout: 20000 });
    const confirm = page.getByRole("button", { name: /Confirm & save 2 students/i });
    await confirm.waitFor({ timeout: 30000 });
    await page.screenshot({ path: join(OUT, `class-scan-match-${tag}.png`), fullPage: false });
    await confirm.click();
    await page.waitForTimeout(1500);
  } catch (e) {
    fail.push(`${tag}: could not drive the flow: ${String(e).split("\n")[0]}`);
    await page.screenshot({ path: join(OUT, `class-scan-FAILED-${tag}.png`), fullPage: true });
  }

  check(saved !== null, `${tag}: the save reached /api/workspace`);
  if (saved) {
    const after = (saved.workspace?.students ?? []).map((s) => s.id);
    const lost = before.filter((id) => !after.includes(id));
    check(lost.length === 0, `${tag}: no student was dropped (lost: ${lost.length}${lost.length ? " — " + lost.join(", ") : ""})`);
    check(otherClass.every((id) => after.includes(id)), `${tag}: every student in the other class is still in the save`);
    check(after.length === before.length + 1, `${tag}: exactly one new student was created (${after.length - before.length})`);
    const graded = (saved.workspace?.assessments ?? []).find((x) => x.id === "ela-demo");
    check(graded && graded.responses.length > a.responses.length, `${tag}: the graded answers were saved`);
  }
  check(errors.length === 0, `${tag}: no uncaught errors${errors.length ? " — " + errors.join(" | ") : ""}`);
  await ctx.close();
}

await browser.close();
console.log("=== CLASS SCAN KEEPS OTHER CLASSES ===");
for (const p of pass) console.log("  OK   " + p);
for (const f of fail) console.log("  FAIL " + f);
console.log(`\n${pass.length}/${pass.length + fail.length} assertions passed`);
process.exit(fail.length ? 1 : 0);
