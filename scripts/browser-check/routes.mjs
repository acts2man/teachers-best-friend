import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const CHROMIUM = process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const ROUTES = [
  ["/",                      "marketing home"],
  ["/contact",               "contact (new)"],
  ["/contact?topic=district","contact, district topic"],
  ["/login",                 "teacher sign-in"],
  ["/login?next=/admin",     "admin sign-in variant"],
  ["/legal/privacy",         "privacy policy"],
  ["/legal/student-data-privacy","student data privacy"],
  ["/legal/how-we-use-ai",   "how we use AI"],
  ["/app",                   "app shell / Overview"],
  ["/assessments",           "Assessments"],
  ["/lessons",               "Lesson plans"],
  ["/classes",               "Classes"],
  ["/students",              "Students"],
  ["/scan",                  "New assessment"],
  ["/standards",             "Standards"],
  ["/diagnostics",           "Class insights"],
  ["/resources",             "Resources"],
  ["/settings",              "Settings"],
  ["/guide",                 "How to use"],
  ["/support",               "Support"],
  ["/signup",                "signup -> /login redirect"],
  ["/review",                "review -> /assessments redirect"],
];

const browser = await chromium.launch({ executablePath: CHROMIUM });
const rows = [];
for (const [path, label] of ROUTES) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
  page.on("pageerror", e => errors.push("UNCAUGHT: " + String(e).slice(0, 160)));
  let status = "?", finalUrl = "", visibleText = "";
  try {
    const res = await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 25000 });
    status = res ? res.status() : "no-response";
    finalUrl = new URL(page.url()).pathname + new URL(page.url()).search;
    visibleText = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
  } catch (e) {
    status = "LOAD-FAIL";
    visibleText = String(e).slice(0, 120);
  }
  // Ignore network failures against Supabase: these run without a signed-in
// session, and sandboxes often cannot reach supabase.co at all.
  const realErrors = errors.filter(e =>
    !/ERR_|Failed to fetch|NetworkError|net::|supabase\.co|503|401|Failed to load resource/i.test(e));
  rows.push({ path, label, status, finalUrl, chars: visibleText.length,
              head: visibleText.slice(0, 70), errors: realErrors });
  await ctx.close();
}
await browser.close();

let bad = 0;
console.log("ROUTE                        STATUS  LANDED ON              TEXT   FIRST WORDS");
console.log("-".repeat(118));
for (const r of rows) {
  const ok = r.status === 200 && r.chars > 40 && r.errors.length === 0;
  if (!ok) bad++;
  console.log(
    (ok ? "OK   " : "CHECK") + " " +
    r.path.padEnd(24) + " " + String(r.status).padEnd(7) + " " +
    r.finalUrl.padEnd(22) + " " + String(r.chars).padStart(5) + "  " + r.head);
  for (const e of r.errors) console.log("        ! " + e);
}
console.log("-".repeat(118));
console.log(`${rows.length - bad}/${rows.length} routes clean`);
