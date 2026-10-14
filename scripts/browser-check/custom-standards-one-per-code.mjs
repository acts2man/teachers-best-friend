// Gap G8, in a browser at 390x844 and 1366x768.
//
// Proven when: neither way of adding custom standards puts a second copy of a
// code into the save (a second copy failed every save), the teacher is told
// which framework already holds it, and a new standard added by hand keeps its
// skills in what is saved (G11's client half; the database half is
// supabase/checks/custom-standards-round-trip.sql).
// Seeded demo data and made-up standards only; /api/* is mocked and every save
// is kept.
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

const std = (code, framework, subject) => ({
  code, framework, subject, grade: 4, title: "Made-up " + code, domain: "", cluster: "", summary: "Made-up wording",
  skills: [], prerequisites: [], next: [], vocabulary: [], misconception: "", example: "", dok: 2, source: "",
});

function fixture() {
  const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
  // A Utah grade 4 class with no Utah standards yet, so the Standards page
  // offers to retrieve them; the library already holds one code under Ohio.
  w.classes = w.classes.map((c) => ({ ...c, demo: false, framework: "Utah", grade: 4 }));
  w.customStandards = [std("4.OA.A.1", "Ohio", "Math")];
  return w;
}
const dupes = (list) => list.length - new Set(list.map((s) => s.code)).size;

const browser = await chromium.launch({ executablePath: CHROMIUM });
for (const [W, H] of [[390, 844], [1366, 768]]) {
  let current = fixture();
  let saves = 0;
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route("**/api/workspace", (r) => {
    if (r.request().method() === "GET") return r.fulfill(json({ workspace: current, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }));
    saves++;
    current = JSON.parse(r.request().postData()).workspace;
    return r.fulfill(json({ revision: 7 + saves }));
  });
  await ctx.route("**/api/analyze", (r) => {
    const body = JSON.parse(r.request().postData());
    // One answer repeats a code; one code is already in the library under Ohio.
    const standards = body.subject === "Math"
      ? [std("4.OA.A.1", "Utah", "Math"), std("4.OA.A.2", "Utah", "Math"), std("4.OA.A.2", "Utah", "Math")]
      : [std("RL.4.1", "Utah", "ELA")];
    return r.fulfill(json({ result: { standards }, model: "mock" }));
  });
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  await ctx.route("**/api/scans/session**", (r) => r.fulfill(json({ state: null, revision: 0 })));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/standards`, { waitUntil: "networkidle" });

  // 1. The catalog loader.
  await page.getByRole("button", { name: /Retrieve Grade 4 standards with AI/ }).click();
  const toast = page.locator("[data-sonner-toast]").first();
  await toast.waitFor({ timeout: 10000 });
  const said = (await toast.innerText()).replace(/\s+/g, " ");
  const codes = current.customStandards.map((s) => s.framework + " " + s.code).sort();
  check(dupes(current.customStandards) === 0, `${W}x${H} loader: no code saved twice (${JSON.stringify(codes)})`);
  check(JSON.stringify(codes) === JSON.stringify(["Ohio 4.OA.A.1", "Utah 4.OA.A.2", "Utah RL.4.1"]), `${W}x${H} loader: the two new codes added once each, the Ohio one kept`);
  check(/2 .*standards added/.test(said) && /1 code was already in your library under Ohio/.test(said), `${W}x${H} loader: the teacher is told ("${said}")`);
  await page.waitForTimeout(400);

  // 2. Standards > Add, with a code the library already holds under Ohio.
  const before = saves;
  await page.getByRole("button", { name: /Add district standard/ }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Standard code").fill("4.OA.A.1");
  await modal.getByLabel("Title", { exact: true }).fill("Made-up district version");
  await modal.getByLabel(/Standard wording/).fill("Made-up wording");
  await modal.getByRole("button", { name: /Save standard/ }).click();
  const err = page.getByText(/4\.OA\.A\.1 is already in your library under Ohio/);
  await err.waitFor({ timeout: 5000 }).catch(() => {});
  check(await err.isVisible(), `${W}x${H} add: refused, naming the framework that holds it`);
  check(saves === before && dupes(current.customStandards) === 0, `${W}x${H} add: nothing saved, still one copy`);

  // 3. A new code by hand keeps its skills in the save.
  await modal.getByLabel("Standard code").fill("D.4.9");
  await modal.getByLabel(/Component skills/).fill("Model it, Explain it");
  await modal.getByRole("button", { name: /Save standard/ }).click();
  await page.waitForTimeout(800);
  const added = current.customStandards.find((s) => s.code === "D.4.9");
  check(added && JSON.stringify(added.skills) === JSON.stringify(["Model it", "Explain it"]), `${W}x${H} add: a new code is saved with its skills (${JSON.stringify(added?.skills)})`);
  const box = await page.locator("body").evaluate((b) => b.scrollWidth <= window.innerWidth);
  check(box, `${W}x${H}: no horizontal scroll`);
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
