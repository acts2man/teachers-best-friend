// The printable student report (Ricky, 22 and 27 Oct 2026), at 390x844 and
// 1366x768: "Student report" on a student's page opens a dialog with the
// Standard Tracker standards to pick, a report-only note box, a
// preview, and "Print or save as PDF". The document it prints holds no other
// student's name, and as a PDF it is one or two pages. Demo data with
// placeholder names; /api/* mocked; nothing is requested from the AI.
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
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
  w.classes = w.classes.map((c) => ({ ...c, demo: false }));
  const me = w.students.find((s) => s.id === "s1");
  me.notes = "Stored note mentioning " + (w.students.find((s) => s.id !== "s1")?.name || "a classmate") + " PRIVATE-STORED.";
  // Plant every classmate's name in a test title so we prove it never prints.
  for (const a of w.assessments) a.title = "Retake for " + w.students.filter((s) => s.id !== "s1").map((s) => s.name).join(", ");
  const others = w.students.filter((s) => s.id !== "s1").flatMap((s) => [s.name, ...s.name.split(/[^\p{L}'’-]+/u).filter((x) => x.length >= 2)]);
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const requests = [];
  await ctx.route("**/api/**", (r) => {
    const url = r.request().url();
    if (url.endsWith("/api/workspace") && r.request().method() === "GET")
      return r.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }));
    if (url.endsWith("/api/quota")) return r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true }));
    if (url.endsWith("/api/events")) return r.fulfill({ status: 204, body: "" });
    requests.push(r.request().method() + " " + url);
    return r.fulfill(json({ revision: 8 }));
  });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    // Keep the printed frame readable: print() would open the dialog.
    window.__printed = [];
    const orig = HTMLIFrameElement.prototype.remove;
    HTMLIFrameElement.prototype.remove = function () {
      if (this.className === "student-report-print") window.__printed.push(this.contentDocument?.documentElement.outerHTML || "");
      return orig.call(this);
    };
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  try {
    await page.goto(`${BASE}/students?id=s1`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Student report" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ timeout: 8000 });
    check((await dialog.locator("textarea").count()) > 0, `${tag}: a report-only note box is offered`);
    const picks = await dialog.locator(".student-report-standards [role=checkbox]").count();
    check(picks > 0, `${tag}: Standard Tracker standards to pick (${picks})`);
    const preview = page.frameLocator(".student-report-preview");
    check((await preview.locator("h2").allInnerTexts()).join("|").includes("Student super grid"), `${tag}: the preview shows the student super grid`);
    check(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag}: nothing scrolls sideways`);
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, `student-report-dialog-${W}.png`) });
    await page.frameLocator(".student-report-preview").locator("body").waitFor();
    page.on("dialog", (d) => d.dismiss());
    await dialog.getByRole("button", { name: "Print or save as PDF" }).click();
    await page.waitForFunction(() => window.__printed.length > 0, null, { timeout: 8000 });
    const printed = (await page.evaluate(() => window.__printed[0])) || "";
    check(printed.includes(me.name), `${tag}: the printed report is ${me.name}'s`);
    const leaked = others.filter((n) => new RegExp("(?<![\\p{L}])" + n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\p{L}])", "u").test(printed));
    check(leaked.length === 0, `${tag}: no other student's name in the printed HTML${leaked.length ? " -- found " + leaked.join(", ") : ""}`);
    check(!printed.includes("PRIVATE-STORED") && !printed.includes("Retake for"), `${tag}: no stored note and no test title in the printout`);
    // A typed note appears; nothing stored does.
    await dialog.locator("textarea").fill("Conference note typed here.");
    await page.waitForTimeout(150);
    page.evaluate(() => (window.__printed = []));
    await dialog.getByRole("button", { name: "Print or save as PDF" }).click();
    await page.waitForFunction(() => window.__printed.length > 0, null, { timeout: 8000 });
    const withNote = (await page.evaluate(() => window.__printed[0])) || "";
    check(withNote.includes("Conference note typed here."), `${tag}: a typed note appears`);
    if (W === 1366) {
      writeFileSync(join(OUT, "student-report.html"), printed);
      const pdfPage = await ctx.newPage();
      await pdfPage.setContent("<!doctype html>" + printed);
      for (const format of ["Letter", "A4"]) {
        const pdf = await pdfPage.pdf({ format, printBackground: true });
        const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) || []).length;
        check(pages >= 1 && pages <= 2, `${tag}: saved as PDF it is ${pages} page(s) on ${format}`);
        if (format === "Letter") writeFileSync(join(OUT, "student-report.pdf"), pdf);
      }
      await pdfPage.screenshot({ path: join(OUT, "student-report-page.png"), fullPage: true });
      await pdfPage.close();
    }
    check(requests.length === 0, `${tag}: nothing sent anywhere ${requests.join(" ")}`);
    check(errors.length === 0, `${tag}: no page errors ${errors.join(" | ")}`);
  } catch (e) {
    fail.push(`${tag}: stopped -- ${String(e.message || e).split("\n")[0]}`);
    await page.screenshot({ path: join(OUT, `student-report-FAILED-${W}.png`) });
  }
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
