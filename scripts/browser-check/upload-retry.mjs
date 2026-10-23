// Upload retry on the class scan (20 Oct: a 72-page scan stopped twice when one
// storage write came back 520), in a browser at 390x844 and 1366x768.
//
// Proven when, importing a roll of 5 photos (3 students) through a fake
// storage where one name-area upload fails once (520) and page 3 fails every
// time: the one-off failure is retried and goes through without the teacher
// seeing anything; page 3 is tried 3 times, then listed as "didn't upload"
// with a Retry button while pages 4 and 5 still upload (the batch does not
// stop); grading is held while it is listed; pressing Retry (storage healthy
// again) uploads it back first in student 2's pile, where it was, and the notice
// goes away. No upload is ever stored twice. Made-up worksheet images; /api/*
// is mocked.
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const SHOTS = process.env.SHOTS || join(OUT, "upload-retry");
const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const CHROMIUM = process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const pass = [];
const fail = [];
const check = (c, m) => (c ? pass : fail).push(m);
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROMIUM });
const maker = await browser.newPage();
const images = await maker.evaluate(() =>
  [1, 2, 3, 4, 5].map((i) => {
    const c = document.createElement("canvas");
    c.width = 850;
    c.height = 1100;
    const g = c.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#111";
    g.font = "40px sans-serif";
    g.fillText("Demo worksheet page " + i, 60, 120);
    return c.toDataURL("image/jpeg", 0.9);
  }),
);
await maker.close();
const files = images.map((u, i) => ({ name: `page-${i + 1}.jpg`, mimeType: "image/jpeg", buffer: Buffer.from(u.split(",")[1], "base64") }));

for (const [W, H] of [[390, 844], [1366, 768]]) {
  const tag = `${W}x${H}`;
  const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
  w.classes = w.classes.map((c) => ({ ...c, demo: false }));
  const stored = new Map(); // sha256 -> record
  const posts = {}; // file name -> POSTs
  let healthy = false;
  let n = 0;
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route("**/api/workspace", (r) =>
    r.request().method() === "GET"
      ? r.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }))
      : r.fulfill(json({ revision: 8 })),
  );
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  await ctx.route("**/api/scans/session**", (r) =>
    r.fulfill(json(r.request().method() === "GET" ? { state: null, revision: 0 } : { revision: 1, ok: true })));
  await ctx.route("**/api/uploads**", (r) => {
    const req = r.request();
    if (req.method() === "GET") {
      const found = stored.get(new URL(req.url()).searchParams.get("sha256"));
      return r.fulfill(found ? json(found) : json({ error: "No matching upload." }, 404));
    }
    const raw = req.postDataBuffer();
    const text = raw.toString("latin1");
    const name = /filename="([^"]+)"/.exec(text)[1];
    // The file's bytes: between the part's blank line and the closing boundary.
    const boundary = text.slice(0, text.indexOf("\r\n"));
    const start = text.indexOf("\r\n\r\n") + 4;
    const body = raw.subarray(start, text.indexOf("\r\n" + boundary, start));
    const sha = createHash("sha256").update(body).digest("hex");
    posts[name] = (posts[name] || 0) + 1;
    const flaky = /^page-1-name/.test(name) && posts[name] === 1; // fails once
    const broken = /^page-3(?!-name)/.test(name) && !healthy; // fails every time
    if (flaky || broken)
      return r.fulfill({ status: 520, contentType: "text/html", body: "<html>520: Web server returned an unknown error</html>" });
    if (!stored.has(sha)) stored.set(sha, { id: "upload-" + ++n, name, size: body.length, mime: "image/jpeg", pages: 1 });
    return r.fulfill(json(stored.get(sha)));
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  await page.goto(`${BASE}/assessments?id=ela-demo&tab=responses`, { waitUntil: "networkidle" });
  await page.locator('input[aria-label="Import a roll of photos of the whole class"]').setInputFiles(files);
  // The importer's own grouping: two photos per student (front and back), so
  // pages 1-2, 3-4 and 5 -- page 3 opens student 2's pile.
  const importer = page.getByRole("button", { name: /^Import \d+ students?/ });
  await importer.waitFor({ timeout: 10000 });
  await importer.click();
  const notice = page.locator(".failed-pages");
  await notice.waitFor({ timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector(".guided-primary .spin"), null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(500);
  const text = (await notice.innerText()).replace(/\s+/g, " ");
  const counts = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  check(/1 page didn't upload after three tries/.test(text) && /page-3\.jpg · student 2/.test(text), `${tag}: page 3 is listed as not uploaded (${text.slice(0, 120)})`);
  check(posts["page-3.jpg"] === 3, `${tag}: page 3 was tried 3 times (${posts["page-3.jpg"]})`);
  check(posts["page-1-name.jpg"] === 2, `${tag}: the one-off failure was retried once and went through (${posts["page-1-name.jpg"]} posts)`);
  check(!!posts["page-4.jpg"] && !!posts["page-5.jpg"], `${tag}: pages 4 and 5 still uploaded after page 3 failed`);
  check(/4 pages scanned/.test(counts), `${tag}: the 4 pages that did upload are kept (${/(\d+ pages? scanned)/.exec(counts)?.[1]})`);
  await page.screenshot({ path: join(SHOTS, `failed-${tag}.png`), fullPage: false });
  await notice.screenshot({ path: join(SHOTS, `notice-${tag}.png`) });

  // Grading is held while a page is missing.
  await page.locator(".guided-primary").filter({ hasText: /grade|credit/i }).last().click();
  await page.waitForTimeout(300);
  const toast = await page.locator("[data-sonner-toast]").allInnerTexts();
  check(toast.some((t) => /didn't upload\. Retry or leave out/.test(t)), `${tag}: grading waits for the missing page (${toast.join(" | ").slice(0, 100)})`);

  // Storage healthy again: Retry.
  healthy = true;
  await notice.getByRole("button", { name: "Retry" }).click();
  await notice.waitFor({ state: "detached", timeout: 30000 });
  const after = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  check(/5 pages scanned/.test(after), `${tag}: after Retry all 5 pages are in (${/(\d+ pages? scanned)/.exec(after)?.[1]})`);
  const draft = await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      if (!k.includes("ela-demo")) continue;
      try {
        const v = JSON.parse(localStorage.getItem(k));
        if (Array.isArray(v?.piles)) return v.piles.map((p) => p.map((x) => x.label));
      } catch {}
    }
    return null;
  });
  check(
    JSON.stringify(draft) === JSON.stringify([["page-1.jpg", "page-2.jpg"], ["page-3.jpg", "page-4.jpg"], ["page-5.jpg"]]),
    `${tag}: page 3 is back first in student 2's pile, where it was scanned (${JSON.stringify(draft)})`,
  );
  check(stored.size === 10, `${tag}: 10 uploads stored (5 pages + 5 name areas), none twice (${stored.size})`);
  check(errors.length === 0, `${tag}: no uncaught errors${errors.length ? " -- " + errors.join(" | ") : ""}`);
  check(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), `${tag}: no sideways scroll`);
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
