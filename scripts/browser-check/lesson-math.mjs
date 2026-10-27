// Lesson math, typeset (Ricky, 25 Oct 2026), at 390x844 and 1366x768: a
// lesson whose practice and exit ticket hold "(x-2)^2" and "2/(x-4)".
//
// Proven when, on screen (practice and exit ticket, task and teacher key):
// no "^" is left, each exponent sits raised above its base and each fraction
// is stacked (numerator above the bar, denominator below); and the print /
// Save-as-PDF document holds the same MathML, measured the same way when
// rendered as print, and saved as a PDF (out/lesson-math/).
// Made-up lesson content; /api/* is mocked.
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const SHOTS = join(OUT, "lesson-math");
mkdirSync(SHOTS, { recursive: true });
const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const CHROMIUM = process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const pass = [];
const fail = [];
const check = (c, m) => (c ? pass : fail).push(m);

const LESSON = {
  objective: "Solve quadratic equations by taking square roots.",
  materials: ["Whiteboards"],
  phases: [{ time: "0–5", name: "Model", text: "Model solving (x-2)^2 = 9." }],
  practice: [
    { q: "Solve (x-2)^2 = 9.", a: "x = 5 or x = -1" },
    { q: "Simplify 2/(x-4) + 3/(x-4).", a: "5/(x-4)" },
    { q: "Evaluate 3x^2 when x = 2, then 1/2 of it.", a: "12, then 6" },
    { q: "If f(x) = x + 6, find f(x)/2 at x = 4 (n/a if undefined), due 3/4.", a: "5" },
  ],
  exit: [{ q: "Solve (x+1)^2 = 16.", a: "x = 3 or x = -5" }],
};

/** Every <msup> raised and every <mfrac> stacked, inside `root`. */
const geometry = (root) =>
  root.evaluate((el) => {
    const out = { sups: 0, fracs: 0, bad: [] };
    for (const m of el.querySelectorAll("msup")) {
      const [base, exp] = [...m.children].map((c) => c.getBoundingClientRect());
      out.sups++;
      if (!(exp.bottom < base.bottom - 2 && exp.left >= base.right - 1)) out.bad.push("msup " + m.textContent);
    }
    for (const f of el.querySelectorAll("mfrac")) {
      const [num, den] = [...f.children].map((c) => c.getBoundingClientRect());
      out.fracs++;
      if (!(num.bottom <= den.top + 1)) out.bad.push("mfrac " + f.textContent);
    }
    out.caret = /\^/.test(el.innerText);
    return out;
  });

const browser = await chromium.launch({ executablePath: CHROMIUM });
for (const [W, H] of [[390, 844], [1366, 768]]) {
  const tag = `${W}x${H}`;
  const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
  w.classes = w.classes.map((c) => ({ ...c, demo: false }));
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route("**/api/workspace", (r) =>
    r.request().method() === "GET"
      ? r.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }))
      : r.fulfill(json({ revision: 8 })),
  );
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  await ctx.route("**/api/scans/session**", (r) => r.fulfill(json({ state: null, revision: 0 })));
  await ctx.route("**/api/analyze", (r) => r.fulfill(json({ model: "mock", result: LESSON })));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  try {
    await page.goto(`${BASE}/lessons?standard=4.NBT.B.5`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Generate an AI lesson plan/ }).click();
    await page.getByRole("tab", { name: /Targeted practice/ }).click();
    // Open every teacher key, so the answers are measured too.
    for (const d of await page.locator(".practice-list details").all()) await d.evaluate((x) => (x.open = true));
    const practice = page.locator(".practice-list").first();
    await practice.locator("math").first().waitFor({ timeout: 15000 });
    const g = await geometry(practice);
    check(!g.caret, `${tag}: practice shows no "^"`);
    check(g.sups >= 2 && g.fracs >= 3 && !g.bad.length, `${tag}: practice exponents raised (${g.sups}) and fractions stacked (${g.fracs})${g.bad.length ? " -- wrong: " + g.bad.join("; ") : ""}`);
    await practice.screenshot({ path: join(SHOTS, `practice-${tag}.png`) });
    // The review's cases: f(x) is the numerator; n/a and the date stay as typed.
    const fourth = practice.locator("article").nth(3);
    const fracs = await fourth.locator("mfrac").evaluateAll((els) => els.map((e) => e.children[0].textContent + " | " + e.children[1].textContent));
    check(JSON.stringify(fracs) === JSON.stringify(["f(x) | 2"]), `${tag}: f(x)/2 stacks with f(x) on top (${fracs.join("; ")})`);
    const said = (await fourth.innerText()).replace(/\s+/g, " ");
    check(/n\/a/.test(said) && /due 3\/4/.test(said), `${tag}: "n/a" and "due 3/4" stay as typed`);

    // Print: the document the print dialog gets.
    await page.getByRole("button", { name: /Print practice/ }).click();
    const printed = await page.waitForFunction(() => {
      const f = [...document.querySelectorAll("iframe")].find((x) => x.contentDocument?.querySelector(".body"));
      return f ? f.contentDocument.documentElement.outerHTML : null;
    }, null, { timeout: 5000 }).then((h) => h.jsonValue(), () => null);
    check(!!printed && /<math[^>]*><msup>/.test(printed) && /<mfrac>/.test(printed) && !/\^/.test(printed.replace(/alttext="[^"]*"/g, "")), `${tag}: the printed practice holds MathML, no "^"`);
    if (printed) {
      const doc = await ctx.newPage();
      await doc.setContent(printed);
      await doc.emulateMedia({ media: "print" });
      const pg = await geometry(doc.locator("body"));
      check(pg.sups >= 2 && pg.fracs >= 2 && !pg.bad.length, `${tag}: printed, exponents raised (${pg.sups}) and fractions stacked (${pg.fracs})`);
      if (W === 1366) await doc.pdf({ path: join(SHOTS, "practice.pdf") });
      await doc.close();
    }

    await page.getByRole("tab", { name: /Exit ticket/ }).click();
    const exit = page.locator(".practice-list").last();
    await exit.locator("math").first().waitFor({ timeout: 10000 });
    const e = await geometry(exit);
    check(!e.caret && e.sups >= 1 && !e.bad.length, `${tag}: exit ticket exponent raised, no "^"`);
    check(errors.length === 0, `${tag}: no page errors ${errors.join(" | ")}`);
  } catch (err) {
    fail.push(`${tag}: stopped -- ${String(err.message || err).split("\n")[0]}`);
    await page.screenshot({ path: join(SHOTS, `FAILED-${tag}.png`), fullPage: true });
  }
  await ctx.close();

  // ---- A browser that cannot lay out MathML (Chrome < 109, old Android
  // WebView, out-of-support Chromebooks): <mspace> measures 0 there, which
  // is what the app checks. The text must show, and print, exactly as typed.
  const old = await browser.newContext({ viewport: { width: W, height: H } });
  await old.addInitScript(() => {
    const real = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      return this.localName === "mspace" ? new DOMRect(0, 0, 0, 0) : real.call(this);
    };
  });
  await old.route("**/api/workspace", (r) =>
    r.request().method() === "GET"
      ? r.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }))
      : r.fulfill(json({ revision: 8 })),
  );
  await old.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
  await old.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  await old.route("**/api/scans/session**", (r) => r.fulfill(json({ state: null, revision: 0 })));
  await old.route("**/api/analyze", (r) => r.fulfill(json({ model: "mock", result: LESSON })));
  const op = await old.newPage();
  try {
    await op.goto(`${BASE}/lessons?standard=4.NBT.B.5`, { waitUntil: "networkidle" });
    await op.getByRole("button", { name: /Generate an AI lesson plan/ }).click();
    await op.getByRole("tab", { name: /Targeted practice/ }).click();
    const list = op.locator(".practice-list").first();
    await list.waitFor({ timeout: 15000 });
    await op.waitForTimeout(500);
    const text = (await list.innerText()).replace(/\s+/g, " ");
    check((await list.locator("math").count()) === 0 && text.includes("Solve (x-2)^2 = 9.") && text.includes("Simplify 2/(x-4) + 3/(x-4)."), `${tag} without MathML: the text shows exactly as typed`);
    await op.getByRole("button", { name: /Print practice/ }).click();
    const printed = await op.waitForFunction(() => {
      const f = [...document.querySelectorAll("iframe")].find((x) => x.contentDocument?.querySelector(".body"));
      return f ? f.contentDocument.querySelector(".body").innerHTML : null;
    }, null, { timeout: 5000 }).then((h) => h.jsonValue(), () => null);
    check(!!printed && !/<math/.test(printed) && printed.includes("Solve (x-2)^2 = 9."), `${tag} without MathML: printed exactly as typed`);
  } catch (err) {
    fail.push(`${tag} without MathML: stopped -- ${String(err.message || err).split("\n")[0]}`);
  }
  await old.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
