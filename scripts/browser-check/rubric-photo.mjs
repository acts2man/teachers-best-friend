// Reading a teacher's own rubric from a photo (Michael, 3 Nov 2026), at
// 412x915 (his Android phone) and 1366x768. The read itself completed on
// production (scan b7314d64, stage "rubric") with this result shape: seven
// traits, max 4 each, three of them with standard "" -- yet the screen said
// "This PDF couldn't be read" and kept the default rubric. Here the network is
// stood in for with that exact shape (placeholder text of the recorded
// lengths), a JPEG is picked, and the screen must show the traits -- the empty
// standards left for the teacher to set -- and save them. Also: a real
// failure (the upload refused, the read failed) shows its own message.
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
// The recorded result: [name length, descriptor length, standard].
const RECORDED = [[11, 109, ""], [10, 130, ""], [17, 160, "W.4.9"], [11, 120, "W.4.9"], [13, 118, ""], [12, 144, "W.4.4"], [11, 187, "L.4.2"]];
const traits = RECORDED.map(([n, d, standard], i) => ({ name: ("Trait " + (i + 1) + " xxxxxxxxxxxxxxxx").slice(0, n), max: 4, descriptor: "d".repeat(d), standard }));

async function run(W, H, mode) {
  const tag = `${W}x${H} ${mode}`;
  const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
  w.classes = w.classes.map((c) => ({ ...c, demo: false }));
  const a = w.assessments.find((x) => x.id === "math-demo");
  const rubric = [{ id: "d1", name: "Default trait", max: 4, descriptor: "Default", standard: "W.4.3" }];
  Object.assign(a, { subject: "ELA", elaArea: "writing", genre: "narrative", rubric, questions: [], responses: [], assignmentUploadIds: [], uploadIds: [] });
  let saved = null;
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route("**/api/workspace", (r) => {
    if (r.request().method() === "GET") return r.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }));
    saved = JSON.parse(r.request().postData() || "{}").workspace;
    return r.fulfill(json({ revision: 8 }));
  });
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  let uploads = 0;
  await ctx.route("**/api/uploads**", (r) => {
    uploads++;
    if (mode === "upload refused" || (mode === "then refused" && uploads > 1))
      return r.fulfill(json({ error: "This PDF couldn’t be read. Try exporting it again, or photograph the pages instead." }, 400));
    return r.fulfill(json({ id: "rubric-upload", name: "rubric.jpg", size: 1296931, mime: "image/jpeg", pages: 1 }));
  });
  await ctx.route("**/api/analyze", (r) => r.fulfill(json({ scanId: "scan-rubric" })));
  await ctx.route("**/api/analyze/scan-rubric", (r) =>
    mode === "read failed"
      ? r.fulfill(json({ status: "failed", error: "The rubric couldn’t be read reliably." }))
      : r.fulfill(json({ status: "complete", result: { traits } })),
  );
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  try {
    await page.goto(BASE + "/assessments?id=math-demo", { waitUntil: "networkidle", timeout: 30000 });
    const input = page.locator('input[aria-label="Upload your own writing rubric"]');
    await input.waitFor({ state: "attached", timeout: 15000 });
    await input.setInputFiles({ name: "rubric.jpg", mimeType: "image/jpeg", buffer: JPEG });
    const notice = page.locator(".key-notice");
    await notice.waitFor({ timeout: 20000 });
    const text = (await notice.innerText()).trim();
    if (mode === "recorded result") {
      check(/^7 traits read from your rubric/.test(text), `${tag}: says the traits were read ("${text}")`);
      check(!/PDF/.test(text), `${tag}: never calls a photo a PDF`);
      const names = await page.locator('input[aria-label$=" standard"]').count();
      check(names === 7, `${tag}: all 7 traits are on screen to check (${names})`);
      const empty = await page.locator('input[aria-label$=" standard"]').evaluateAll((els) => els.filter((e) => !e.value).length);
      check(empty === 3, `${tag}: the 3 with no standard are left empty for the teacher (${empty})`);
      check(/set a standard|no standard|choose its standard|pick a standard/i.test(await page.locator(".panel").filter({ has: input }).innerText()), `${tag}: and says to set them`);
      await page.getByRole("button", { name: "Save rubric" }).click();
      await page.waitForTimeout(800);
      const r = saved?.assessments?.find((x) => x.id === "math-demo")?.rubric;
      check(!!r && r.length === 7 && r.filter((d) => !d.standard).length === 3, `${tag}: saves all 7, empty standards included`);
    } else if (mode === "upload refused") {
      check(/^“rubric\.jpg” couldn’t be uploaded: This PDF couldn’t be read/.test(text), `${tag}: names the file and gives the server's reason ("${text}")`);
    } else if (mode === "then refused") {
      // A first read worked; a second try is refused.
      await input.setInputFiles({ name: "rubric2.jpg", mimeType: "image/jpeg", buffer: JPEG });
      await page.waitForFunction(() => /rubric2\.jpg/.test(document.querySelector(".key-notice")?.textContent || ""), null, { timeout: 15000 });
      const second = (await notice.innerText()).trim();
      check(/“rubric2\.jpg” couldn’t be uploaded/.test(second) && /The 7 traits read earlier are still below — Save rubric to keep them\./.test(second), `${tag}: a later failure keeps and points to the 7 unsaved traits ("${second}")`);
      check((await page.locator('input[aria-label$=" standard"]').count()) === 7, `${tag}: and they are still on screen`);
    } else {
      check(text.includes("couldn’t be read reliably"), `${tag}: shows the real reason ("${text}")`);
    }
    await page.screenshot({ path: join(OUT, `rubric-photo-${W}-${mode.replace(/\s+/g, "-")}.png`) });
    check(errors.length === 0, `${tag}: no page errors ${errors.join(" | ")}`);
  } catch (e) {
    fail.push(`${tag}: stopped -- ${String(e.message || e).split("\n")[0]}`);
    await page.screenshot({ path: join(OUT, `rubric-photo-FAILED-${W}.png`) });
  }
  await ctx.close();
}

for (const [W, H] of [[412, 915], [1366, 768]])
  for (const mode of ["recorded result", "upload refused", "read failed", "then refused"]) await run(W, H, mode);
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
