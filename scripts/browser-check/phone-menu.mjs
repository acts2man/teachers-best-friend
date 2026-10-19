// Michael, 19 Oct 2026 (Android Brave, about 412px wide): the phone menu showed
// New assessment, the credits, a large empty gap, then Settings / Support /
// Admin / View as teacher / Sign out -- the main pages were in a scroll area
// that looked empty.
//
// Proven when, at 390x844 and 412x915 with the menu open: every main page
// (Home, Classes, Assessments, ... and the toolkit pages) is visible on screen
// without scrolling, directly under New assessment and the credits; the
// settings group comes after them with no large empty gap (it may scroll);
// and at 1366x768 the sidebar is unchanged (its screenshot is saved to
// compare against main's). Seeded demo data; /api/* is mocked.
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const SHOTS = process.env.SHOTS || join(OUT, "phone-menu");
const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const CHROMIUM = process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const pass = [];
const fail = [];
const check = (c, m) => (c ? pass : fail).push(m);
mkdirSync(SHOTS, { recursive: true });

const REF = (process.env.NEXT_PUBLIC_SUPABASE_URL || "https://mmzbgmquhfdfqaootrvh.supabase.co").match(/https:\/\/([^.]+)/)[1];
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const USER = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "demo@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const SESSION = {
  access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: USER.id, aud: "authenticated", role: "authenticated", exp, iat: exp - 3600, email: USER.email })}.x`,
  token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "demo", user: USER,
};
const w = JSON.parse(readFileSync(join(OUT, "fixture.json"), "utf8"));
w.classes = w.classes.map((c) => ({ ...c, demo: false }));

const browser = await chromium.launch({ executablePath: CHROMIUM });
for (const [W, H] of [[390, 844], [412, 915], [1366, 768]]) {
  const tag = `${W}x${H}`;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, isMobile: W < 800, hasTouch: W < 800 });
  await ctx.route("**/api/workspace", (r) =>
    r.fulfill(json({ workspace: w, revision: 7, aiReady: true, authProvider: "supabase", impersonating: null })),
  );
  // Michael is an admin, so his menu also has Admin and View as teacher --
  // the taller settings group that squeezed the pages out of sight. The admin
  // flag is read from Supabase in the browser; a fake session and profile row
  // stand in for it (display only -- nothing here reaches Supabase).
  await ctx.addCookies([{ name: `sb-${REF}-auth-token`, value: "base64-" + Buffer.from(JSON.stringify(SESSION)).toString("base64url"), url: BASE }]);
  await ctx.route("**/auth/v1/user**", (r) => r.fulfill(json(SESSION.user)));
  await ctx.route("**/auth/v1/token**", (r) => r.fulfill(json(SESSION)));
  await ctx.route("**/rest/v1/profiles**", (r) => r.fulfill(json({ is_admin: true, is_app_manager: false })));
  await ctx.route("**/api/quota", (r) => r.fulfill(json({ plan_id: "starter", quota: 150, used: 20, remaining: 130, can_scan: true })));
  await ctx.route("**/api/events", (r) => r.fulfill({ status: 204, body: "" }));
  await ctx.route("**/api/scans/session**", (r) => r.fulfill(json({ state: null, revision: 0 })));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/app`, { waitUntil: "networkidle" });

  if (W >= 800) {
    const side = page.locator("[data-slot=sidebar-container]").first();
    await side.waitFor();
    await side.screenshot({ path: join(SHOTS, `sidebar-${tag}.png`) });
    check(true, `${tag}: computer sidebar saved for comparison with main's`);
    await ctx.close();
    continue;
  }

  await page.locator(".mobile-menu").first().click();
  const sheet = page.locator("[data-mobile=true]");
  await sheet.waitFor({ timeout: 10000 });
  await page.waitForTimeout(500); // the sheet slides in
  await page.screenshot({ path: join(SHOTS, `menu-${tag}.png`) });

  const m = await page.evaluate(() => {
    const vh = window.innerHeight;
    const sheet = document.querySelector("[data-mobile=true]");
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.height === 0 || r.bottom > vh + 1 || r.top < 0) return false;
      const hit = document.elementFromPoint(r.left + Math.min(20, r.width / 2), r.top + r.height / 2);
      return !!hit && (el === hit || el.contains(hit));
    };
    const links = [...sheet.querySelectorAll(".nav-link")];
    const footer = sheet.querySelector(".side-footer");
    const firstFooter = footer?.querySelector(".footer-link");
    const lastLink = links[links.length - 1];
    const newScan = sheet.querySelector(".new-scan");
    return {
      pages: links.map((l) => [l.innerText.trim(), visible(l)]),
      newScanVisible: !!newScan && visible(newScan),
      gap: firstFooter && lastLink ? Math.round(firstFooter.getBoundingClientRect().top - lastLink.getBoundingClientRect().bottom) : null,
      settingsAfterPages: firstFooter && lastLink ? firstFooter.getBoundingClientRect().top > lastLink.getBoundingClientRect().top : false,
      footerItems: footer ? [...footer.querySelectorAll(".footer-link")].map((e) => e.innerText.trim()) : [],
    };
  });
  check(m.footerItems.some((t) => /admin/i.test(t)), `${tag}: the admin's settings group, as Michael sees it (${m.footerItems.join(", ")})`);
  const hidden = m.pages.filter(([, v]) => !v).map(([t]) => t);
  check(m.pages.length >= 6 && hidden.length === 0, `${tag}: all ${m.pages.length} main pages visible without scrolling${hidden.length ? " -- hidden: " + hidden.join(", ") : ""}`);
  check(m.newScanVisible, `${tag}: New assessment visible`);
  check(m.settingsAfterPages, `${tag}: the settings group (${m.footerItems.join(", ")}) comes after the pages`);
  check(m.gap !== null && m.gap >= 0 && m.gap <= 48, `${tag}: no large empty gap between the pages and the settings group (${m.gap}px)`);
  // The settings group is reachable by scrolling the menu.
  await page.locator("[data-mobile=true] .side-footer .footer-link").last().scrollIntoViewIfNeeded();
  const signOut = await page.locator("[data-mobile=true] .side-footer .footer-link").last().isVisible();
  check(signOut, `${tag}: the last settings item can be scrolled to`);
  await page.screenshot({ path: join(SHOTS, `menu-scrolled-${tag}.png`) });
  await ctx.close();
}
await browser.close();
for (const x of pass) console.log("PASS", x);
for (const x of fail) console.log("FAIL", x);
console.log(`${pass.length}/${pass.length + fail.length}`);
process.exit(fail.length ? 1 : 0);
