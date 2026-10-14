// Every grading-flow screen at 360, 390, 412, 430 and 1366 px wide, with
// real-length names and long math answers, checked for text or buttons that
// overlap, are cut off, or run off the screen -- measured in the browser, not
// eyeballed -- and a full-page screenshot of each.
//
// The data is the app's own demo workspace (make-fixture.mjs) with its names
// and answers lengthened to the size of a real class: invented names, no real
// student. Only the network is stood in for.
//
//   node scripts/browser-check/make-fixture.mjs
//   node scripts/browser-check/phone-overlap-audit.mjs            # all screens, all widths
//   SCREENS=grade-by-question WIDTHS=412 node scripts/browser-check/phone-overlap-audit.mjs
import { chromium } from "playwright";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out", "audit");
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const CHROMIUM = process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const WIDTHS = (process.env.WIDTHS || "360,390,412,430,1366").split(",").map(Number);
const HEIGHT = { 360: 780, 390: 844, 412: 915, 430: 932, 1366: 768 };

const LONG_NAMES = [
  "Alexandria Montgomery-Fitzgerald", "Bartholomew Okonkwo-Reyes", "Guadalupe Villanueva Castillo",
  "Maximiliano Delacroix-Whitfield", "Anastasia Kowalczyk-Brennan", "Christopher Nakamura-Oyelaran",
  "Esperanza Hernández de la Cruz", "Oluwaseun Adebayo-Thompson", "Jacqueline Van der Westhuizen",
  "Thanh-Huong Nguyen-Abernathy", "Krishnamurthy Venkataraman", "Wilhelmina Featherstonehaugh",
];
const LONG_ANSWERS = [
  "x = (3 ± √17) / 4 ≈ 1.78 or −0.28",
  "2x/(x² − 4), x ≠ ±2",
  "P(t) = 12000e^(0.04t); P(5) = 12000e^(1/5) ≈ 14,656.83 people",
  "A(t) = 2500(1.009)^(4t); A(10) = $3,577.56",
  "shift right 1, reflect over x-axis, vertical stretch 2, up 4; y = 4; (0, 10/3)",
  "t = 3·log₂(80) ≈ 18.97 hours",
];

function fixture() {
  const w = JSON.parse(readFileSync(join(HERE, "out", "fixture.json"), "utf8"));
  w.classes = w.classes.map((c) => ({ ...c, demo: false }));
  w.students = w.students.map((s, i) => ({ ...s, name: LONG_NAMES[i % LONG_NAMES.length] + (i >= LONG_NAMES.length ? " " + (i + 1) : "") }));
  for (const a of w.assessments) {
    a.questions = a.questions.map((q, i) => (i % 2 ? { ...q, text: q.text + " Show every step of your work, simplify completely, and state any values excluded from the domain." } : q));
    a.responses = a.responses.map((r, i) => {
      const long = LONG_ANSWERS[i % LONG_ANSWERS.length];
      return i % 3 === 0 ? { ...r, answer: long, finalAnswer: long } : r;
    });
  }
  return w;
}

/** Measured in the page: pairs of visible text boxes that overlap, elements
 * that run past the right edge, and text cut off by its own box. */
function measure() {
  const vw = document.documentElement.clientWidth;
  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  // Leaf-ish text carriers and controls.
  const nodes = [...document.querySelectorAll("body *")].filter((el) => {
    if (!visible(el) || el.closest("[aria-hidden='true'], .sr-only, svg, [data-sonner-toaster]")) return false;
    // Inside a closed <details> (other than its summary) nothing is drawn,
    // though Chromium still gives it a layout box.
    const closed = el.closest("details:not([open])");
    if (closed && !el.closest("summary")) return false;
    if (/^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return true;
    // A label with no text of its own is a layout wrapper, not something to read.
    if (el.tagName === "LABEL") return !!(el.innerText || "").trim() && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    return [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
  });
  const label = (el) => (el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "") + ' "' + (el.innerText || el.value || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 40) + '"');
  const rects = nodes.map((el) => ({ el, r: el.getBoundingClientRect() }));
  const overlaps = [];
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      // More than a hairline both ways: real overlap, not touching borders.
      if (x > 3 && y > 3) {
        // Ignore a box drawn ON TOP of another on purpose (dialogs, sticky bars).
        const pos = (el) => getComputedStyle(el).position;
        if (["fixed", "sticky"].includes(pos(a.el)) !== ["fixed", "sticky"].includes(pos(b.el))) continue;
        overlaps.push(label(a.el) + "  ×  " + label(b.el));
      }
    }
  const offscreen = rects.filter(({ r }) => r.right > vw + 1 || r.left < -1).map(({ el }) => label(el));
  const clipped = nodes
    .filter((el) => {
      const s = getComputedStyle(el);
      return (s.overflowX === "hidden" || s.overflow === "hidden") && s.textOverflow !== "ellipsis" && el.scrollWidth > el.clientWidth + 2;
    })
    .map(label);
  const pageScroll = document.documentElement.scrollWidth > vw + 1;
  return { overlaps: [...new Set(overlaps)].slice(0, 25), offscreen: [...new Set(offscreen)].slice(0, 25), clipped: [...new Set(clipped)].slice(0, 25), pageScroll };
}

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

async function context(browser, width) {
  const w = fixture();
  const ctx = await browser.newContext({ viewport: { width, height: HEIGHT[width] ?? 900 }, deviceScaleFactor: 1 });
  await ctx.route("**/api/workspace", (r) =>
    r.request().method() === "GET"
      ? r.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }))
      : r.fulfill(json({ revision: 8 })));
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  await ctx.route("**/api/scans/session**", (r) => r.fulfill(json(r.request().method() === "GET" ? { state: null, revision: 0 } : { revision: 1 })));
  return { ctx, w };
}

const firstStudent = (w, id) => w.students.find((s) => s.classId === w.assessments.find((a) => a.id === id).classId)?.id;

const SCREENS = {
  "assessment-review-and-standards": async (page) => page.goto(`${BASE}/assessments?id=math-demo&tab=questions`, { waitUntil: "networkidle" }),
  "answer-key": async (page) => page.goto(`${BASE}/assessments?id=math-demo&tab=key`, { waitUntil: "networkidle" }),
  "class-scan-and-grade-by-question": async (page) => page.goto(`${BASE}/assessments?id=math-demo&tab=responses`, { waitUntil: "networkidle" }),
  "grade-by-question-open-question": async (page) => {
    await page.goto(`${BASE}/assessments?id=math-demo&tab=responses`, { waitUntil: "networkidle" });
    const q = page.locator("#grade-by-question button, #grade-by-question [role=button]").first();
    if (await q.count()) await q.click().catch(() => {});
    await page.waitForTimeout(400);
  },
  "one-student-review": async (page, w) => page.goto(`${BASE}/assessments?id=math-demo&tab=responses&student=${firstStudent(w, "math-demo")}`, { waitUntil: "networkidle" }),
  "standards-report": async (page) => page.goto(`${BASE}/assessments?id=math-demo&tab=coverage`, { waitUntil: "networkidle" }),
  "class-analysis": async (page) => page.goto(`${BASE}/assessments?id=math-demo&tab=analysis`, { waitUntil: "networkidle" }),
};
// Name matching is only reachable by scanning: import four photos (two
// students), grade them with the AI calls answered by fixed demo data, and stop
// on the matching screen. One name matches the roster, one does not.
SCREENS["name-matching"] = async (page, w, ctx) => {
  let n = 0;
  await ctx.route("**/api/uploads**", (r) => r.fulfill(json({ id: "upload-" + ++n, name: "page.jpg", size: 120000, mime: "image/jpeg", pages: 1 })));
  await ctx.route("**/api/scans/reserve", (r) => r.fulfill(json({ charged: 4, alreadyPaid: 0, remaining: 126 })));
  await ctx.route("**/api/scans/release", (r) => r.fulfill(json({ ok: true })));
  const a = w.assessments.find((x) => x.id === "ela-demo");
  const roster = w.students.filter((s) => s.classId === a.classId);
  await ctx.route("**/api/analyze", async (r) => {
    const p = JSON.parse(r.request().postData() || "{}");
    const NAMES = { "upload-2": roster[0].name, "upload-6": "Maximiliano Alejandro Delacroix-Whitfield" };
    if (p.mode === "name_strip")
      return r.fulfill(json({ result: { pages: p.uploadIds.map((id, i) => ({ page: i, name: NAMES[id] ?? "", confidence: NAMES[id] ? 96 : 0, box: null })) } }));
    return r.fulfill(json({ result: { groups: p.pageGroups.map((_, g) => ({ group: g, responses: a.questions.map((q, i) => ({ questionId: q.id, answer: LONG_ANSWERS[i % LONG_ANSWERS.length], verdict: "other", finalAnswer: LONG_ANSWERS[i % LONG_ANSWERS.length] })) })) } }));
  });
  await page.goto(`${BASE}/assessments?id=ela-demo&tab=responses`, { waitUntil: "networkidle" });
  await page.locator('input[aria-label="Import a roll of photos of the whole class"]').setInputFiles(await jpegs(page));
  await page.getByRole("button", { name: /Import 2 students/i }).click({ timeout: 10000 });
  await page.getByRole("button", { name: /^Grade/i }).first().click({ timeout: 20000 });
  await page.getByRole("button", { name: /Confirm & save 2 students/i }).waitFor({ timeout: 30000 });
};

async function jpegs(page) {
  const urls = await page.evaluate(() =>
    [0, 1, 2, 3].map((i) => {
      const c = document.createElement("canvas");
      c.width = 850;
      c.height = 1100;
      const g = c.getContext("2d");
      g.fillStyle = "#fff";
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = "#111";
      g.font = "40px sans-serif";
      g.fillText("Demo page " + (i + 1), 60, 120);
      return c.toDataURL("image/jpeg", 0.9);
    }),
  );
  return urls.map((u, i) => ({ name: `page-${i}.jpg`, mimeType: "image/jpeg", buffer: Buffer.from(u.split(",")[1], "base64") }));
}

const only = process.env.SCREENS ? process.env.SCREENS.split(",") : Object.keys(SCREENS);

const browser = await chromium.launch({ executablePath: CHROMIUM });
const report = [];
for (const name of only) {
  for (const width of WIDTHS) {
    const { ctx, w } = await context(browser, width);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
    await SCREENS[name](page, w, ctx);
    await page.waitForTimeout(700);
    const m = await page.evaluate(measure);
    await page.screenshot({ path: join(OUT, `${name}-${width}.png`), fullPage: true });
    // The part a teacher acts on, close up, for the name-matching rows.
    const focus = name === "name-matching" ? page.locator(".name-match-row").first().locator("..") : null;
    if (focus && (await focus.count())) await focus.screenshot({ path: join(OUT, `${name}-${width}-rows.png`) }).catch(() => {});
    report.push({ screen: name, width, ...m, errors });
    const bad = m.overlaps.length + m.offscreen.length + m.clipped.length + (m.pageScroll ? 1 : 0) + errors.length;
    console.log(`${bad ? "FAIL" : "ok  "} ${name.padEnd(34)} ${String(width).padStart(4)}  overlaps ${m.overlaps.length}  off-screen ${m.offscreen.length}  clipped ${m.clipped.length}${m.pageScroll ? "  PAGE SCROLLS SIDEWAYS" : ""}${errors.length ? "  errors " + errors.length : ""}`);
    await ctx.close();
  }
}
await browser.close();
writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 1));
const failing = report.filter((r) => r.overlaps.length || r.offscreen.length || r.clipped.length || r.pageScroll || r.errors.length);
console.log(`\n${report.length - failing.length}/${report.length} screen-widths clean. Details: ${join(OUT, "report.json")}`);
process.exit(failing.length ? 1 : 0);
