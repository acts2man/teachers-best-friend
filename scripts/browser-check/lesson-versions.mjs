// Lesson plan changes (Ricky, 27 Oct 2026), in a browser at 390x844 and
// 1366x768. Proven when one generate sends three requests side by side (the
// full lesson and two flow-only versions, all in flight at once), the
// approach tabs switch the lesson flow between Visual, Hands-on and Auditory
// while practice and the exit ticket stay one set, Game-Based Learning and
// Performance Task follow the exit ticket, and "Add question" adds one
// question to the practice and to the exit ticket, sending that section's
// questions so it does not repeat them. Demo data; /api/* mocked (no AI spend).
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
const flow = (label) => ({ materials: [label + " kit"], phases: [{ time: "0–5", name: label + " launch", text: label + " way in" }, { time: "5–15", name: label + " practice", text: label + " practice" }] });

const browser = await chromium.launch({ executablePath: CHROMIUM });
for (const [W, H] of [[390, 844], [1366, 768]]) {
  const tag = `${W}x${H}`;
  const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
  w.classes = w.classes.map((c) => ({ ...c, demo: false }));
  const requests = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  await ctx.route("**/api/workspace", (r) =>
    r.request().method() === "GET"
      ? r.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }))
      : r.fulfill(json({ revision: 8 })),
  );
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  // As production runs a lesson (every lesson on record has a job id): the
  // POST is charged and answers with a scan id at once; the model works for
  // a while; the poll gets the result. Since the review of #199 the two free
  // versions start once the full lesson's scan id is back, so all three are
  // in flight together.
  const jobs = new Map();
  const duration = (part) => (part === "full" ? 2400 : part === "flow" ? 1800 : 300);
  await ctx.route("**/api/analyze", async (r) => {
    const p = JSON.parse(r.request().postData() || "{}");
    requests.push(p);
    const now = Date.now();
    inFlight = [...jobs.values()].filter((j) => now < j.until).length + 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const id = "job-" + requests.length;
    jobs.set(id, { p, until: now + duration(p.lessonPart ?? "full") });
    return r.fulfill(json({ scanId: id }));
  });
  await ctx.route("**/api/analyze/job-*", async (r) => {
    const job = jobs.get(r.request().url().split("/").pop());
    if (Date.now() < job.until) return r.fulfill(json({ status: "analyzing" }));
    const p = job.p;
    const part = p.lessonPart ?? "full";
    if (part === "question") return r.fulfill(json({ status: "complete", result: { q: "New " + p.section + " question?", a: "new answer" } }));
    const label = p.modality === "Kinesthetic" ? "HandsOn" : p.modality;
    if (part === "flow") return r.fulfill(json({ status: "complete", result: flow(label) }));
    return r.fulfill(json({ status: "complete", result: {
      objective: "Demo objective", ...flow(label),
      practice: [{ q: "Practice one?", a: "1" }, { q: "Practice two?", a: "2" }], exit: [{ q: "Exit one?", a: "e1" }],
      game: { title: "Fact Relay", materials: ["Cones"], steps: ["Line up", "Solve and run"], connection: "Each leg practises the standard." },
      performanceTask: { title: "Plan the field trip", minutes: 18, groupSize: "Groups of 3–4", scenario: "Your group plans a class trip.", steps: ["Plan", "Present"], success: ["Correct operations", "Clear reasoning"] },
    } }));
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  const sideScroll = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  try {
    await page.goto(`${BASE}/lessons?standard=4.OA.A.3`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Generate an AI lesson plan" }).click();
    await page.locator(".lesson-generated-in").waitFor({ timeout: 15000 });
    const parts = requests.map((p) => (p.lessonPart ?? "full") + ":" + p.modality).sort();
    check(JSON.stringify(parts) === JSON.stringify(["flow:Auditory", "flow:Kinesthetic", "full:Visual"]), `${tag}: one generate, three requests (${parts.join(", ")})`);
    check(maxInFlight === 3, `${tag}: side by side -- all three in flight at once (${maxInFlight})`);
    const took = Number(((await page.locator(".lesson-generated-in").innerText()).match(/([\d.]+) s/) || [])[1]);
    // The app polls every 1.5 s or so: the slowest job (2.4 s) is seen at the
    // second or third poll -- well under the 6 s the three would take in turn.
    check(took > 2.3 && took < 5.5, `${tag}: so it took about the slowest one, not the sum (${took} s; 2.4 s full + 1.8 s × 2 mocked)`);
    const flowText = async () => (await page.locator(".lesson-timeline").innerText()).replace(/\s+/g, " ");
    check(/Visual launch/.test(await flowText()), `${tag}: the Visual version first`);
    await page.getByRole("tab", { name: /Hands-on/ }).click();
    check(/HandsOn launch/.test(await flowText()), `${tag}: Hands-on switches the flow`);
    await page.getByRole("tab", { name: /Auditory/ }).click();
    check(/Auditory launch/.test(await flowText()), `${tag}: and Auditory`);
    const tabs = (await page.locator(".text-tabs [role=tab]").allInnerTexts()).map((t) => t.trim());
    check(JSON.stringify(tabs.slice(-3)) === JSON.stringify(["Exit ticket", "Game-Based Learning", "Performance Task"]), `${tag}: … Exit ticket, Game-Based Learning, Performance Task last (${tabs.join(" | ")})`);
    await page.getByRole("tab", { name: "Game-Based Learning" }).click();
    check(/Fact Relay/.test(await page.locator(".lesson-extra").innerText()), `${tag}: the game shows`);
    await page.getByRole("tab", { name: "Performance Task" }).click();
    check(/18 minutes · Groups of 3–4/.test(await page.locator(".lesson-extra").innerText()), `${tag}: the task shows, 15–20 minutes in small groups`);
    await page.getByRole("tab", { name: "Targeted practice" }).click();
    const before = requests.length;
    await page.locator(".practice-actions").getByRole("button", { name: "Add question" }).click();
    await page.getByText("New practice question?").waitFor({ timeout: 10000 });
    const q = requests[before];
    check(q?.lessonPart === "question" && q.section === "practice" && JSON.stringify(q.existing) === JSON.stringify(["Practice one?", "Practice two?"]), `${tag}: Add question asks for one more, sending the practice's own (${JSON.stringify(q?.existing)})`);
    check((await page.locator(".practice-list article").count()) === 3, `${tag}: a third practice question is added`);
    await page.getByRole("tab", { name: "Exit ticket" }).click();
    await page.locator(".exit-actions").getByRole("button", { name: "Add question" }).click();
    await page.getByText("New exit question?").waitFor({ timeout: 10000 });
    check(requests.at(-1)?.section === "exit", `${tag}: and in the exit ticket`);
    check(!(await sideScroll()), `${tag}: nothing scrolls sideways`);
    check(errors.length === 0, `${tag}: no page errors ${errors.join(" | ")}`);
    await page.screenshot({ path: join(OUT, `lesson-versions-${W}.png`) });
  } catch (e) {
    fail.push(`${tag}: stopped -- ${String(e.message || e).split("\n")[0]}`);
    await page.screenshot({ path: join(OUT, `lesson-versions-FAILED-${W}.png`) });
  }
  await ctx.close();
}
await browser.close();
for (const m of pass) console.log("PASS", m);
for (const m of fail) console.log("FAIL", m);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
