// Ricky (phone, 26 Oct 2026): inside a test, "All assessments" did not go
// back. After a full page load of /assessments?id=..., Next's router.push to
// the same page does nothing (scripts/browser-check/back-to-assessments.mjs
// reproduces it at 390x844 and 412x915). go() now sends a URL on the current
// page through history.pushState, and everything else through the router.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { buildSync } from "esbuild";

function bundle(path) {
  const r = buildSync({ entryPoints: [path], bundle: true, platform: "node", format: "cjs", write: false });
  const m = { exports: {} };
  new Function("module", "exports", r.outputFiles[0].text)(m, m.exports);
  return m.exports;
}

function run(from, to) {
  assert.ok(existsSync("lib/navigate.ts"), "lib/navigate.ts exists");
  const { navigate } = bundle("lib/navigate.ts");
  const u = new URL(from);
  const pushed = [], routed = [];
  navigate({ push: (x) => routed.push(x) }, to, { href: u.href, origin: u.origin, pathname: u.pathname }, { pushState: (_s, _t, x) => pushed.push(x) });
  return { pushed, routed };
}

test("All assessments from inside a test changes the URL itself", () => {
  assert.deepEqual(run("https://app.test/assessments?id=a1&tab=questions", "/assessments"), { pushed: ["/assessments"], routed: [] });
});

test("another tab of the same test changes the URL itself", () => {
  assert.deepEqual(run("https://app.test/assessments?id=a1&tab=responses", "/assessments?id=a1&tab=analysis"), {
    pushed: ["/assessments?id=a1&tab=analysis"],
    routed: [],
  });
});

test("another page still goes through the router", () => {
  assert.deepEqual(run("https://app.test/assessments?id=a1", "/students"), { pushed: [], routed: ["/students"] });
  assert.deepEqual(run("https://app.test/scan", "/assessments?id=a1"), { pushed: [], routed: ["/assessments?id=a1"] });
});

test("the app's go() uses it", () => {
  const app = readFileSync("components/teacher-app.tsx", "utf8");
  assert.match(app, /go: \(url: string\) => navigate\(router, url\)/);
  assert.doesNotMatch(app, /go: \(url: string\) => router\.push\(url\)/);
});
