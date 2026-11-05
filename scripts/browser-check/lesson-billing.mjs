// What a lesson costs (review of #199), at 390x844 and 1366x768. Three runs:
//   one version fails  -> the lesson shows the other two, the credit is asked
//                         back for that Generate's run, and the toast says
//                         which version is missing and that it was free;
//   the full one fails -> the two flows that came back are kept, with the
//                         practice and exit ticket empty, and it says so;
//   out of credits     -> a 402 on the full lesson: a plain lesson-worded
//                         message, no lesson, no refund asked.
// All three requests of a Generate carry the same lessonRun. Demo data;
// /api/* mocked (no AI spend).
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
const flow = (label) => ({ materials: [label + " kit"], phases: [{ time: "0–5", name: label + " launch", text: label + " way in" }] });
const full = (label) => ({
  objective: "Demo objective", ...flow(label),
  practice: [{ q: "Practice one?", a: "1" }], exit: [{ q: "Exit one?", a: "e1" }],
  game: { title: "Fact Relay", materials: ["Cones"], steps: ["Run"], connection: "Practises it." },
  performanceTask: { title: "Plan a trip", minutes: 18, groupSize: "Groups of 3–4", scenario: "Plan.", steps: ["Plan"], success: ["Right"] },
});

const browser = await chromium.launch({ executablePath: CHROMIUM });
for (const [W, H] of [[390, 844], [1366, 768]]) {
  for (const run of ["one version fails", "the full one fails", "out of credits"]) {
    const tag = `${W}x${H} ${run}`;
    const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
    w.classes = w.classes.map((c) => ({ ...c, demo: false }));
    const requests = [];
    const refunds = [];
    const ctx = await browser.newContext({ viewport: { width: W, height: H } });
    await ctx.route("**/api/workspace", (r) =>
      r.request().method() === "GET" ? r.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null })) : r.fulfill(json({ revision: 8 })),
    );
    await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
    await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
    await ctx.route("**/api/lessons/refund", (r) => {
      refunds.push(JSON.parse(r.request().postData() || "{}"));
      return r.fulfill(json({ refunded: true }));
    });
    await ctx.route("**/api/analyze", async (r) => {
      const p = JSON.parse(r.request().postData() || "{}");
      requests.push(p);
      const label = p.modality === "Kinesthetic" ? "HandsOn" : p.modality;
      const part = p.lessonPart ?? "full";
      if (run === "out of credits" && part === "full") return r.fulfill(json({ error: "This is 1 page. You have no credits left this period." }, 402));
      if (run === "one version fails" && part === "flow" && p.modality === "Kinesthetic") return r.fulfill(json({ error: "The AI service couldn’t complete this analysis." }, 502));
      if (run === "the full one fails" && part === "full") return r.fulfill(json({ error: "The AI service couldn’t complete this analysis." }, 502));
      return r.fulfill(json({ model: "mock", result: part === "flow" ? flow(label) : full(label) }));
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
    try {
      await page.goto(`${BASE}/lessons?standard=4.OA.A.3`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Generate an AI lesson plan" }).click();
      const toast = page.locator("[data-sonner-toast]").last();
      page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text().slice(0, 300)); });
      await toast.waitFor({ timeout: 15000 });
      await page.waitForTimeout(300);
      const said = (await toast.innerText()).replace(/\s+/g, " ").trim();
      const runs = new Set(requests.map((p) => p.lessonRun));
      check(requests.length === 3 && runs.size === 1 && /^[0-9a-f-]{36}$/.test([...runs][0]), `${tag}: the three requests share one lessonRun`);
      if (run === "one version fails") {
        check(refunds.length === 1 && refunds[0].lessonRun === [...runs][0], `${tag}: the credit is asked back for that run`);
        check(said.includes("Your lesson plan is ready, but the Hands-on version didn’t come back. You weren’t charged for this Generate."), `${tag}: says what is missing and that it was free ("${said}")`);
        await page.getByRole("tab", { name: /Auditory/ }).click();
        check(/Auditory launch/.test(await page.locator(".lesson-timeline").innerText()), `${tag}: and shows what came back`);
      } else if (run === "the full one fails") {
        check(refunds.length === 1, `${tag}: the credit is asked back`);
        check(/^The Visual version didn’t come back, and the practice and exit ticket come with the first one — they are empty below\. Use Add question, or generate again\. You weren’t charged/.test(said), `${tag}: says so ("${said}")`);
        await page.getByRole("tab", { name: /Hands-on/ }).click();
        check(/HandsOn launch/.test(await page.locator(".lesson-timeline").innerText()), `${tag}: the flows that came back are kept`);
      } else {
        check(refunds.length === 0, `${tag}: nothing was charged, so no refund is asked`);
        check(/^Generating a lesson uses 1 credit, and you have none left this period, so it wasn’t written\. Nothing was charged\./.test(said), `${tag}: a plain message ("${said}")`);
        check(!(await page.locator(".lesson-timeline").count()), `${tag}: and no lesson`);
      }
      check(errors.length === 0, `${tag}: no page errors ${errors.join(" | ")}`);
      await page.screenshot({ path: join(OUT, `lesson-billing-${W}-${run.replace(/\s+/g, "-")}.png`) });
    } catch (e) {
      fail.push(`${tag}: stopped -- ${String(e.message || e).split("\n")[0]} ${errors.join(" | ")}`);
      await page.screenshot({ path: join(OUT, `lesson-billing-FAILED-${W}.png`) });
    }
    await ctx.close();
  }
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
