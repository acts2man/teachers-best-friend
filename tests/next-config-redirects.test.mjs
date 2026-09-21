// A config redirect must never shadow a real page.
//
// Redirects declared in next.config.ts run BEFORE routing. A source that
// matches a page under app/ wins outright: the page is built, deployed, and
// never reached. Nothing else notices -- not the build, not the type checker,
// not the test suite, not a code review of the page itself, because the page
// is fine. The only symptom is on the live site.
//
// That is not hypothetical. { source: "/signup", destination: "/login" } was
// added on 2026-09-14, when there was no sign-up page. app/signup/page.tsx
// arrived later and never rendered in production: the live site answered
// GET /signup?plan=tier1 with a 307 to /login?plan=tier1, dropping the plan a
// teacher had just chosen and landing them in sign-in mode. It took reading
// the deployed site from outside to find it.
//
// So this reads the real redirects() and the real app/ tree and fails if one
// covers the other.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);

/** The real next.config.ts, loaded rather than re-described. */
function loadConfig() {
  const r = buildSync({
    entryPoints: ["next.config.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    absWorkingDir: ROOT,
    // `next` is only imported for its types, which are erased.
    external: ["next"],
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, require);
  return m.exports.default ?? m.exports;
}

/**
 * Every concrete URL path the app/ directory serves.
 *
 * Route groups -- the (marketing) style directories -- are organisational and
 * contribute nothing to the URL, so they are stripped. Dynamic segments are
 * deliberately NOT collected: see the note on the assertion below.
 */
function staticRoutes(dir = path.join(ROOT, "app"), prefix = "") {
  const routes = new Set();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile()) {
      if (entry.name === "page.tsx" || entry.name === "route.ts")
        routes.add(prefix === "" ? "/" : prefix);
      continue;
    }
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    // (group) -> no URL segment. @slot and _private are not routes at all.
    if (name.startsWith("@") || name.startsWith("_")) continue;
    const segment = name.startsWith("(") && name.endsWith(")") ? "" : `/${name}`;
    for (const r of staticRoutes(path.join(dir, name), prefix + segment)) routes.add(r);
  }
  return routes;
}

test("the app tree is readable and finds the routes we know exist", () => {
  // If this walker silently found nothing, the real assertion below would
  // pass for the wrong reason forever.
  const routes = staticRoutes();
  assert.ok(routes.size > 5, `expected several routes, found ${routes.size}`);
  assert.ok(routes.has("/"), "the marketing homepage should resolve to /");
  assert.ok(routes.has("/login"), "/login should be found");
  assert.ok(routes.has("/api/billing/webhook"), "nested API routes should be found");
});

test("no redirect source shadows a page that exists", async () => {
  const config = loadConfig();
  const redirects = await config.redirects();
  const routes = staticRoutes();

  const shadowed = redirects
    .map((r) => r.source)
    // Only exact, static sources. A source with a parameter or a wildcard is
    // a different shape of question and is not what bit us.
    .filter((source) => !/[:*?(]/.test(source))
    .filter((source) => routes.has(source));

  assert.deepEqual(
    shadowed,
    [],
    `next.config.ts redirects these paths, but app/ also serves them, so the page will never render: ${shadowed.join(", ")}`,
  );
});

test("/signup is served by the app, not redirected away", () => {
  // The specific regression, named. A teacher choosing a paid plan goes
  // through here, and the plan they picked rides on the query string.
  const routes = staticRoutes();
  assert.ok(routes.has("/signup"), "app/signup/page.tsx should exist");
});

test("/signup is not in redirects() at all", async () => {
  const config = loadConfig();
  const redirects = await config.redirects();
  assert.equal(
    redirects.find((r) => r.source === "/signup"),
    undefined,
    "a /signup redirect would shadow app/signup/page.tsx again",
  );
});

test("a redirect covering a path the app does not serve is still allowed", async () => {
  // /review is the legitimate case and must keep working. app/[view] declares
  // dynamicParams = false with a fixed list that does not include "review", so
  // without the redirect /review is a 404. Dynamic segments are not treated as
  // shadowing for exactly this reason: a redirect that fills a gap in a
  // dynamic route's static params is doing real work, not hiding a page.
  const config = loadConfig();
  const redirects = await config.redirects();
  const review = redirects.find((r) => r.source === "/review");
  assert.ok(review, "/review should still redirect");
  assert.equal(review.destination, "/assessments");
  assert.ok(!staticRoutes().has("/review"), "there is no app/review page to shadow");
});
