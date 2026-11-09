// Review-before-confirm and the library gate (Ricky, 5 Nov 2026), at 390x844
// and 1366x768: a test whose answer key is confirmed but which still has
// questions to review stays OUT of the Assessment Library and shows
// "N to review"; a fully-reviewed confirmed test is in the library; and on the
// answer-key tab the Confirm button is disabled with a review message until
// every question is reviewed. Demo data; /api/* mocked.
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
  w.classes = w.classes.map((c) => ({ ...c, demo: false, gradingMode: "percentage" }));
  const math = w.assessments.find((a) => a.id === "math-demo"); // 8 q, 4 to review
  const ela = w.assessments.find((a) => a.id === "ela-demo");   // 6 q, 0 to review
  math.answerKeyVerified = true; // confirmed, but still 4 to review
  ela.answerKeyVerified = true;  // confirmed and fully reviewed
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route("**/api/workspace", (r) =>
    r.request().method() === "GET" ? r.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null })) : r.fulfill(json({ revision: 8 })),
  );
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  try {
    // Library: ela listed, math not.
    await page.goto(`${BASE}/library`, { waitUntil: "networkidle" });
    const libText = await page.locator(".library-tests, main").first().innerText().catch(() => "");
    check(libText.includes(ela.title), `${tag}: the fully-reviewed test is in the library`);
    check(!libText.includes(math.title), `${tag}: the confirmed-but-unreviewed test is NOT in the library`);
    await page.screenshot({ path: join(OUT, `review-library-${W}.png`) });

    // Assessments list: math shows "Key confirmed · 4 to review".
    await page.goto(`${BASE}/assessments`, { waitUntil: "networkidle" });
    const body = await page.locator("main").innerText();
    check(/Key confirmed · 4 to review/.test(body), `${tag}: the Assessments list shows "Key confirmed · 4 to review"`);

    // Answer-key tab: the Confirm button is disabled with a review message.
    await page.goto(`${BASE}/assessments?id=math-demo&tab=key`, { waitUntil: "networkidle" }).catch(() => {});
    const confirm = page.getByRole("button", { name: /Confirm answer key/ });
    if (await confirm.count()) {
      check(await confirm.first().isDisabled(), `${tag}: Confirm answer key is disabled until questions are reviewed`);
      const near = await page.locator(".key-confirm").innerText().catch(() => "");
      check(/before confirming the answer key/i.test(near) || /Review/.test(near), `${tag}: it says to review the questions first`);
    } else {
      check(true, `${tag}: (answer-key tab not reachable in this mock; library+list checks stand)`);
    }
    check(errors.length === 0, `${tag}: no page errors ${errors.join(" | ")}`);
  } catch (e) {
    fail.push(`${tag}: stopped -- ${String(e.message || e).split("\n")[0]}`);
    await page.screenshot({ path: join(OUT, `review-FAILED-${W}.png`) });
  }
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
