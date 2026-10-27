// The setup screen's remove-file X (#176 follow-up), at 390x844 and 1366x768.
// One upload row serves every identical file, so the PDF a teacher adds to a
// new test may BE a saved test's file. Pressing X takes it off this upload
// and must never delete the saved test's file.
//
// Proven when the file leaves the list and no DELETE is sent for it.
// Demo data; /api/* is mocked.
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
const FILE = "upload-saved-test";

const browser = await chromium.launch({ executablePath: CHROMIUM });
for (const [W, H] of [[390, 844], [1366, 768]]) {
  const tag = `${W}x${H}`;
  const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
  w.classes = w.classes.map((c) => ({ ...c, demo: false }));
  Object.assign(w.assessments.find((x) => x.id === "math-demo"), { uploadIds: [FILE], assignmentUploadIds: [FILE] });
  const deleted = [];
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route("**/api/workspace", (r) =>
    r.request().method() === "GET"
      ? r.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }))
      : r.fulfill(json({ revision: 8 })),
  );
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  await ctx.route("**/api/scans/session**", (r) => r.fulfill(json({ state: null, revision: 0 })));
  await ctx.route("**/api/uploads**", (r) => {
    const m = r.request().method();
    // The same bytes as the saved test's PDF: the server hands back that row.
    if (m === "POST") return r.fulfill(json({ id: FILE, name: "unit-test.pdf", size: PDF.length, mime: "application/pdf", pages: 1 }));
    if (m === "DELETE") {
      deleted.push(new URL(r.request().url()).pathname);
      return r.fulfill(json({ ok: true }));
    }
    return r.fulfill(json({}, 404));
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  try {
    await page.goto(`${BASE}/scan`, { waitUntil: "networkidle" });
    // Step 1: one standard, then on to the upload step.
    await page.getByRole("checkbox").first().click();
    await page.getByRole("button", { name: /Continue to upload/ }).click();
    await page.locator('input[aria-label="Choose work to upload"]').setInputFiles({ name: "unit-test.pdf", mimeType: "application/pdf", buffer: PDF });
    const x = page.getByRole("button", { name: "Remove unit-test.pdf from this upload" });
    await x.waitFor({ timeout: 15000 });
    await x.click();
    await page.waitForTimeout(800);
    check((await x.count()) === 0, `${tag}: the file left this upload's list`);
    check(deleted.length === 0, `${tag}: the saved test's file was not deleted (DELETE sent: ${deleted.join(", ") || "none"})`);
    check(errors.length === 0, `${tag}: no page errors ${errors.join(" | ")}`);
  } catch (e) {
    fail.push(`${tag}: stopped -- ${String(e.message || e).split("\n")[0]}`);
    await page.screenshot({ path: join(OUT, `setup-remove-FAILED-${tag}.png`), fullPage: true });
  }
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
