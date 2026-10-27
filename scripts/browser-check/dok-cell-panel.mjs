// The DOK grid's cell panel (D2), in a browser at 390x844 and 1366x768.
//
// Proven when, on Class analysis: tapping a scored cell opens its panel (a
// bottom sheet on a phone, a side sheet on a computer) with the cell's score,
// level, recommendation and question count; its common errors are the error
// types tagged on the cell's answers, most common first; the next step reads
// "Reteach DOK 2" for a Beginning cell and "Offer extension activity DOK 2" for
// an Exceeding DOK 1 cell (an extension aims one level up); ticking DOK 3 adds
// it; the button opens the lesson generator with standard, intent and dok, the
// page says "DOK 2, 3" and "Aimed at: ...", and the lesson request carries
// dok [2, 3] and the error-type names with counts -- and no student name or
// answer. Nothing scrolls sideways. Seeded demo data; /api/* is mocked and the
// lesson request is captured.
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const SHOTS = process.env.SHOTS || join(OUT, "dok-cell-panel");
const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const CHROMIUM = process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const pass = [];
const fail = [];
const check = (c, m) => (c ? pass : fail).push(m);
mkdirSync(SHOTS, { recursive: true });

const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
w.classes = w.classes.map((c) => ({ ...c, demo: false }));
const math = w.assessments.find((a) => a.id === "math-demo");
// Tag the wrong answers on 4.OA.A.3 (DOK 2): 5 sign errors, 2 wrong formulas.
const oa = new Set(math.questions.filter((q) => q.standard === "4.OA.A.3").map((q) => q.id));
const wrong = math.responses.filter((r) => oa.has(r.questionId) && r.verified && !r.correct);
wrong.slice(0, 5).forEach((r) => (r.errorType = "Sign Error"));
wrong.slice(5, 7).forEach((r) => (r.errorType = "Setup/Method Error"));
// And one with the teacher's own label under "Other" (24 Oct list): shown in
// the panel as typed, sent to the AI only as "Other".
wrong[7].errorType = "Other: forgot to carry";
const names = w.students.map((s) => s.name);

const browser = await chromium.launch({ executablePath: CHROMIUM });
for (const [W, H] of [[390, 844], [1366, 768]]) {
  const tag = `${W}x${H}`;
  const phone = W < 768;
  let lessonRequest = null;
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route("**/api/workspace", (r) =>
    r.request().method() === "GET"
      ? r.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }))
      : r.fulfill(json({ revision: 8 })),
  );
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  await ctx.route("**/api/scans/session**", (r) => r.fulfill(json({ state: null, revision: 0 })));
  await ctx.route("**/api/analyze", (r) => {
    lessonRequest = JSON.parse(r.request().postData() || "{}");
    return r.fulfill(json({ model: "mock", result: {
      objective: "Demo objective", materials: ["Paper"], phases: [{ time: "5 min", name: "Model", text: "Demo" }],
      practice: [{ q: "Demo problem", a: "1" }], exit: [{ q: "Demo exit", a: "1" }],
    } }));
  });
  const page = await ctx.newPage();
  const noSideScroll = async (where) =>
    check(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), `${tag} ${where}: no sideways scroll`);
  const cellOf = (code, dok) => page.locator(`.dok-grid-row[aria-label="${code}"] .dok-cell`).nth(dok - 1);

  await page.goto(`${BASE}/assessments?id=math-demo&tab=analysis`, { waitUntil: "networkidle" });
  await page.waitForSelector(".dok-grid", { timeout: 15000 });

  // An Exceeding DOK 1 cell: the extension aims one level up.
  await cellOf("4.NBT.B.4", 1).click();
  let panel = page.locator(".dok-cell-panel");
  await panel.waitFor({ timeout: 10000 });
  check(/Offer extension activity DOK 2/.test(await panel.innerText()), `${tag} Exceeding DOK 1 cell: next step "Offer extension activity DOK 2"`);
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "detached", timeout: 10000 });

  // A Beginning DOK 2 cell with tagged errors.
  await cellOf("4.OA.A.3", 2).click();
  panel = page.locator(".dok-cell-panel");
  await panel.waitFor({ timeout: 10000 });
  await page.waitForTimeout(800); // the sheet slides in over 500ms
  const text = (await panel.innerText()).replace(/\s+/g, " ");
  check(/4\.OA\.A\.3 · DOK 2/.test(text) && /50%/.test(text) && /Beginning · Reteach Recommended/.test(text) && /3 questions \(Q4, Q5, Q8\)/.test(text), `${tag} panel: score, level, recommendation and questions (${text.slice(0, 140)})`);
  const errors = await panel.locator(".dok-cell-errors li strong").allInnerTexts();
  check(JSON.stringify(errors) === JSON.stringify(["Sign Error", "Setup/Method Error", "Other: forgot to carry"]), `${tag} panel: common errors, most common first (${errors.join(", ")})`);
  check(/5 answers/.test(text) && /2 answers/.test(text), `${tag} panel: with their counts`);
  const side = await panel.getAttribute("data-side");
  check(side === (phone ? "bottom" : "right"), `${tag} panel: a ${phone ? "bottom" : "side"} sheet (${side})`);
  const box = await panel.boundingBox();
  check(box && box.x >= -1 && box.x + box.width <= W + 1, `${tag} panel: fits the screen`);
  const button = panel.getByRole("button", { name: /^Reteach DOK 2/ });
  check((await button.count()) === 1, `${tag} panel: next step "Reteach DOK 2"`);
  await panel.getByRole("checkbox", { name: "DOK 3" }).click();
  check(/Reteach DOK 2 \+ DOK 3/.test(await button.innerText()), `${tag} panel: ticking DOK 3 adds it to the lesson`);
  await panel.screenshot({ path: join(SHOTS, `panel-${tag}.png`) });
  await noSideScroll("panel");

  await button.click();
  await page.waitForURL(/\/lessons\?/, { timeout: 10000 });
  const url = decodeURIComponent(page.url());
  check(/standard=4\.OA\.A\.3/.test(url) && /intent=reteach/.test(url) && /dok=2,3/.test(url) && /assessment=math-demo/.test(url), `${tag} lesson link carries standard, intent and dok (${url.split("?")[1]})`);
  const context = (await page.locator(".reteach-context").innerText()).replace(/\s+/g, " ");
  check(/DOK 2, 3/.test(context) && /Aimed at: Sign Error \(5\), Setup\/Method Error \(2\), Other \(1\)/.test(context), `${tag} lessons page: says the DOK levels and the errors it aims at (${context.slice(0, 160)})`);
  await page.getByRole("button", { name: "Generate an AI lesson plan" }).click();
  await page.waitForFunction(() => !document.body.innerText.includes("Building your plan"), null, { timeout: 15000 }).catch(() => {});
  check(lessonRequest?.mode === "lesson" && JSON.stringify(lessonRequest.dok) === "[2,3]", `${tag} lesson request: dok [2, 3] (${JSON.stringify(lessonRequest?.dok)})`);
  check(
    JSON.stringify(lessonRequest?.errorTypes) === JSON.stringify([{ name: "Sign Error", count: 5 }, { name: "Setup/Method Error", count: 2 }, { name: "Other", count: 1 }]),
    `${tag} lesson request: error-type names and counts (${JSON.stringify(lessonRequest?.errorTypes)})`,
  );
  const body = JSON.stringify(lessonRequest ?? {});
  check(!names.some((n) => body.includes(n)) && !wrong.some((r) => (r.finalAnswer || r.answer) && body.includes(JSON.stringify(r.finalAnswer || r.answer))), `${tag} lesson request: no student name, no student answer`);
  check(!body.includes("forgot to carry"), `${tag} lesson request: the teacher's own Other label never in it`);
  await noSideScroll("lessons page");
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
