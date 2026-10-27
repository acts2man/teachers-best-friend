// One upload row per identical file (#176), driven through the real test
// page at 390x844 and 1366x768: a test made from a PDF, then the SAME PDF
// read as its passage. The server hands back the test's own upload for the
// identical bytes, as the one-row-per-hash rule does.
//
// Proven when the passage is read and saved, nothing deletes the test's file,
// and the test's file still opens afterwards.
// Demo data, made-up text; /api/* is mocked.
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
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
const FILE = "upload-pdf";

const browser = await chromium.launch({ executablePath: CHROMIUM });
for (const [W, H] of [[390, 844], [1366, 768]]) {
  const tag = `${W}x${H}`;
  const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
  w.classes = w.classes.map((c) => ({ ...c, demo: false }));
  const a = w.assessments.find((x) => x.id === "ela-demo");
  Object.assign(a, { uploadIds: [FILE], assignmentUploadIds: [FILE], passage: "" });
  const deleted = new Set();
  let saved = null;
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route("**/api/workspace", (r) => {
    if (r.request().method() === "GET") return r.fulfill(json({ workspace: saved ?? w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }));
    saved = JSON.parse(r.request().postData() || "{}").workspace;
    return r.fulfill(json({ revision: 8 }));
  });
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  await ctx.route("**/api/scans/session**", (r) => r.fulfill(json({ state: null, revision: 0 })));
  await ctx.route("**/api/uploads**", (r) => {
    const m = r.request().method();
    const id = decodeURIComponent(new URL(r.request().url()).pathname.split("/").pop());
    // The same bytes as the test's PDF: the server reuses that row.
    if (m === "POST") return r.fulfill(json({ id: FILE, name: "test.pdf", size: PDF.length, mime: "application/pdf", pages: 1 }));
    if (m === "DELETE") {
      deleted.add(id);
      return r.fulfill(json({ ok: true }));
    }
    if (m === "GET" && id === FILE) return deleted.has(FILE) ? r.fulfill(json({ error: "not found" }, 404)) : r.fulfill({ status: 200, contentType: "application/pdf", body: PDF });
    return r.fulfill(json({}, 404));
  });
  await ctx.route("**/api/analyze", (r) => r.fulfill(json({ model: "mock", result: { text: "A made-up story about a lighthouse keeper." } })));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  try {
    await page.goto(`${BASE}/assessments?id=ela-demo&tab=questions`, { waitUntil: "networkidle" });
    await page.locator('input[aria-label="Upload pages of the passage"]').setInputFiles({ name: "test.pdf", mimeType: "application/pdf", buffer: PDF });
    await page.waitForFunction(() => /lighthouse keeper/.test(document.querySelector('[aria-label="The reading passage"]')?.value ?? ""), null, { timeout: 20000 });
    await page.waitForTimeout(800);
    check(!!saved?.assessments.find((x) => x.id === "ela-demo")?.passage, `${tag}: the passage was read and saved`);
    check(!deleted.has(FILE), `${tag}: the test's file was not deleted (deleted: ${[...deleted].join(", ") || "nothing"})`);
    const status = await page.evaluate(async (id) => (await fetch("/api/uploads/" + id)).status, FILE);
    check(status === 200, `${tag}: the test's file still opens (${status})`);
    check(errors.length === 0, `${tag}: no page errors ${errors.join(" | ")}`);
  } catch (e) {
    fail.push(`${tag}: stopped -- ${String(e.message || e).split("\n")[0]}`);
    await page.screenshot({ path: join(OUT, `shared-upload-FAILED-${tag}.png`) });
  }
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
