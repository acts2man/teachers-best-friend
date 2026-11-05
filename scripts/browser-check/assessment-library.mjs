// Assessment Library (Ricky, 23 and 27 Oct 2026), at 390x844 and 1366x768:
// it is in the menu; tests with a confirmed key are grouped by course; a test
// offers only classes graded the same way and says what to do for the others;
// picking a class saves the link, switches to that class and lands on Student
// work; New assessment points to the library. Demo data with two extra
// placeholder classes; /api/* mocked, the saved workspace captured.
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
  w.classes = [
    ...w.classes.map((c) => ({ ...c, demo: false, gradingMode: "percentage" })),
    { id: "class-b", name: "Class B", grade: 4, framework: w.classes[0].framework, demo: false, gradingMode: "percentage" },
    { id: "class-c", name: "Class C", grade: 4, framework: w.classes[0].framework, demo: false, gradingMode: "sbg" },
  ];
  let saved = null;
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route("**/api/workspace", (r) => {
    if (r.request().method() === "GET")
      return r.fulfill(json({ workspace: saved || w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }));
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
    await page.goto(`${BASE}/scan`, { waitUntil: "networkidle" });
    const hint = page.locator(".library-hint");
    await hint.waitFor({ timeout: 15000 }).catch(() => {});
    check(!(await hint.count()), `${tag}: New assessment has no library hint while this class already has every library test`);
    await page.goto(`${BASE}/library`, { waitUntil: "networkidle" });
    await page.locator(".library-course").first().waitFor({ timeout: 15000 });
    check((await page.locator("h1").innerText()).includes("Assessment library"), `${tag}: the library page opens at /library`);
    const courses = await page.locator(".library-course > h2").allInnerTexts();
    check(courses.length === 2 && /^Grade 4 ELA/.test(courses[0]) && /^Grade 4 Math/.test(courses[1]), `${tag}: grouped by course, alphabetical (${courses.map((c) => c.replace(/\s+/g, " ")).join(" | ")})`);
    if (W >= 1024) check(await page.locator('a[href="/library"]').first().isVisible(), `${tag}: it is in the menu`);
    check(!(await sideScroll()), `${tag}: the library does not scroll sideways`);
    await page.screenshot({ path: join(OUT, `assessment-library-${W}.png`), fullPage: false });
    const math = page.locator(".library-course", { hasText: "Grade 4 Math" }).locator(".library-test").first();
    const mathLeft = (await math.locator(".library-setup-left").innerText().catch(() => "")).trim();
    check(mathLeft === "4 questions to review before scanning", `${tag}: a confirmed-key test with questions left says so ("${mathLeft}")`);
    const ela = page.locator(".library-course", { hasText: "Grade 4 ELA" }).locator(".library-test").first();
    check(!(await ela.locator(".library-setup-left").count()), `${tag}: a ready test has no such note`);
    await ela.getByRole("button").click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ timeout: 5000 });
    const offered = await dialog.locator(".library-class > span:first-child").allInnerTexts();
    check(offered.join(",") === "The Explorers,Class B", `${tag}: only classes graded the same way are offered (${offered.join(", ")})`);
    const note = (await dialog.locator(".library-other-mode").innerText()).replace(/\s+/g, " ");
    check(/1 class is graded Standards-Based\. To use it in a Standards-Based class, upload it again as a new test\./.test(note), `${tag}: and it says what to do for the other class ("${note}")`);
    check(!(await sideScroll()), `${tag}: the picker does not scroll sideways`);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, `assessment-library-pick-${W}.png`), fullPage: false });
    await dialog.locator(".library-class", { hasText: "Class B" }).click();
    await page.waitForURL(/\/assessments\?id=ela-demo&tab=responses&from=library/, { timeout: 10000 });
    check(true, `${tag}: picking Class B lands on the test's Student work step`);
    const t = saved && saved.assessments.find((a) => a.id === "ela-demo");
    check(!!t && (t.classIds || []).includes("class-b") && t.classId === "demo", `${tag}: the save links it to Class B and keeps its home class`);
    check(saved && saved.activeClassId === "class-b", `${tag}: and puts Class B on screen`);
    check(saved && saved.assessments.length === w.assessments.length, `${tag}: no copy of the test is made`);
    await page.locator('[role="tab"][aria-selected="true"]', { hasText: "Student work" }).waitFor({ timeout: 10000 });
    check(true, `${tag}: the Student work tab is the one open`);
    await page.waitForTimeout(600);
    const top = await page.locator(".student-review-space").evaluate((el) => el.getBoundingClientRect().top);
    check(top >= 60 && top < H / 2, `${tag}: scrolled so the class-set upload is in view (top ${Math.round(top)})`);
    const added = await page.locator(".assignment-status-bar > div").filter({ hasText: "Student work" }).first().innerText().catch(() => "");
    check(/0 added/.test(added.replace(/\s+/g, " ")), `${tag}: Student work counts Class B's students, not the first class's ("${added.replace(/\s+/g, " ")}")`);
    check(!(await page.getByText("then scanning is enabled").count()), `${tag}: and scanning is on (the test is ready)`);
    check(await page.locator(".guided-primary").first().waitFor({ timeout: 5000 }).then(() => page.locator(".guided-primary").first().isEnabled()).catch(() => false), `${tag}: with the class-set upload right there, enabled`);
    await page.screenshot({ path: join(OUT, `assessment-library-landed-${W}.png`), fullPage: false });
    // The Math test, 4 questions still to review: it opens on that review, not a scan that is off.
    await page.goto(`${BASE}/library`, { waitUntil: "networkidle" });
    await page.locator(".library-course").first().waitFor({ timeout: 15000 });
    await page.locator(".library-course", { hasText: "Grade 4 Math" }).locator(".library-test").first().getByRole("button").click();
    await page.getByRole("dialog").locator(".library-class", { hasText: "Class B" }).click();
    await page.waitForURL(/\/assessments\?id=math-demo&tab=questions/, { timeout: 10000 });
    check(true, `${tag}: a test with questions left opens on its review step instead`);
    check(errors.length === 0, `${tag}: no page errors ${errors.join(" | ")}`);
  } catch (e) {
    fail.push(`${tag}: stopped -- ${String(e.message || e).split("\n")[0]}`);
    await page.screenshot({ path: join(OUT, `assessment-library-FAILED-${W}.png`) });
  }
  // New assessment, in a class that does not have the test yet, points to the library.
  try {
    const p2 = await ctx.newPage();
    saved = null;
    w.activeClassId = "class-b";
    await p2.goto(`${BASE}/scan`, { waitUntil: "networkidle" });
    const hint = p2.locator(".library-hint");
    await hint.waitFor({ timeout: 15000 });
    check(/Pick it from your Assessment library/.test(await hint.innerText()), `${tag}: New assessment in a class without it points to the library`);
    await hint.getByRole("button").click();
    await p2.waitForURL(/\/library/, { timeout: 10000 });
    check(true, `${tag}: and the link opens the library`);
    w.activeClassId = "demo";
  } catch (e) {
    fail.push(`${tag}: hint -- ${String(e.message || e).split("\n")[0]}`);
  }
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
