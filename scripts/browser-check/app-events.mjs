// PR 1 item A, browser half: an error forced in a 390px session is sent to
// /api/events with the right route, viewport and build -- and a failed API call
// and a failed save are recorded too. The server half (RLS, rate limit) is
// tested on Postgres; see the PR.
//
//   COMMIT_REF=$(git rev-parse HEAD) npm run build:netlify && npx next start -p 3100
//   node scripts/browser-check/make-fixture.mjs
//   EXPECT_BUILD=$(git rev-parse HEAD) node scripts/browser-check/app-events.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const CHROMIUM = process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const EXPECT_BUILD = process.env.EXPECT_BUILD || "";
const workspace = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));

const pass = [];
const fail = [];
const check = (cond, msg) => (cond ? pass : fail).push(msg);

const browser = await chromium.launch({ executablePath: CHROMIUM });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
});
const posted = [];
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
await ctx.route("**/api/events", (r) => {
  posted.push(JSON.parse(r.request().postData() || "{}"));
  return r.fulfill({ status: 204, body: "" });
});
await ctx.route("**/api/workspace", (r) =>
  r.request().method() === "GET"
    ? r.fulfill(json({ workspace, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null }))
    : r.fulfill(json({ error: "This classroom changed in another tab." }, 409)));
await ctx.route("**/api/quota", (r) => r.fulfill(json({ error: "down" }, 503)));

const page = await ctx.newPage();
await page.goto(`${BASE}/assessments?id=ela-demo&tab=responses`, { waitUntil: "networkidle", timeout: 30000 });
// The forced error: thrown outside any React boundary, the way a broken event
// handler or timer throws on a teacher's phone. Carries a fake "student name"
// in quotes to prove it never leaves the page.
await page.evaluate(() => setTimeout(() => { throw new Error('Forced test error near "Student Name"'); }, 0));
await page.evaluate(() => { void Promise.reject(new Error("Forced unhandled rejection")); });
// A save that loses to another device.
await page.evaluate(() => fetch("/api/workspace", { method: "PUT", body: "{}" }).catch(() => {}));
await page.waitForTimeout(3500);

const events = posted.flatMap((p) => p.events);
const forced = events.find((e) => e.type === "client_error" && /Forced test error/.test(e.message));
check(!!forced, "the forced error was sent");
if (forced) {
  check(forced.route === "/assessments", `route is the template "/assessments" (got "${forced.route}")`);
  check(forced.viewportW === 390 && forced.viewportH === 844, `viewport 390x844 (got ${forced.viewportW}x${forced.viewportH})`);
  check(EXPECT_BUILD ? forced.build === EXPECT_BUILD : true, `build is ${EXPECT_BUILD || "(not checked)"} (got ${forced.build})`);
  check(!/Student Name/.test(JSON.stringify(forced)), "the quoted text never left the page");
  check(!!forced.stack, "a stack came with it");
}
check(events.some((e) => e.type === "unhandled_rejection"), "the unhandled rejection was sent");
check(events.some((e) => e.type === "api_failure" && e.detail?.status === 503), "the failed API call (503) was sent");
check(events.some((e) => e.type === "sync_failure" && e.detail?.status === 409), "the failed save (409) was sent as a sync failure");
check(posted.every((p) => /iPhone/.test(p.userAgent) && p.sessionId), "every post carries the session id and user agent");
check(!JSON.stringify(posted).includes("?id="), "no query string (where ids ride) was sent");

console.log("=== APP EVENTS (390x844) ===");
for (const p of pass) console.log("  OK   " + p);
for (const f of fail) console.log("  FAIL " + f);
console.log(`\n${pass.length}/${pass.length + fail.length} assertions passed`);
await browser.close();
process.exit(fail.length ? 1 : 0);
