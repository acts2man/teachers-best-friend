// The app refuses to run anywhere but its real address.
//
// The rule lives in lib/canonical-host.ts and is shared by the server guard
// (proxy.ts, guardOrigin) and the on-load client redirect, so it is tested
// once here. The decision is: only the "production" deploy context is
// host-locked; deploy previews, branch deploys and localhost stand down.
//
// A note on the prompt's own wording. It asks for "a branch deploy refused"
// alongside "a deploy preview allowed" and, separately, that branch deploys
// used for checks MUST NOT break. Those cannot both hold if branch deploys were
// host-locked, so the reconciliation is by context, not by hostname shape: a
// build running in the branch-deploy CONTEXT is allowed (checks keep working),
// while a branch-deploy-style HOST reached in PRODUCTION context -- a promoted
// build or a permalink carrying the production env -- is refused. Both are
// asserted below.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);

function bundle(entry) {
  const r = buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    absWorkingDir: ROOT,
    alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

const H = bundle("lib/canonical-host.ts");
const CANON = "teachersbestfriend.netlify.app";

test("the canonical host is allowed in production", () => {
  assert.equal(H.isCanonicalHost(CANON, CANON), true);
  assert.equal(H.hostRefusal(CANON, { context: "production", canonical: CANON }), null);
});

test("a deploy permalink host is refused, and the message names the real address", () => {
  const permalink = "6aa86be8b9484a000816ae63--teachersbestfriend.netlify.app";
  const r = H.hostRefusal(permalink, { context: "production", canonical: CANON });
  assert.ok(r, "a permalink in production must be refused");
  assert.ok(r.includes(`https://${CANON}`), "the refusal names the real address");
  assert.ok(/bookmark/i.test(r), "the refusal tells the teacher how to recover");
});

test("a branch-deploy host reached in production is refused", () => {
  // A branch build promoted to production, or its permalink, carries the
  // production env and is not the canonical host: refuse.
  const branchHost = "feat-canonical-host--teachersbestfriend.netlify.app";
  assert.ok(H.hostRefusal(branchHost, { context: "production", canonical: CANON }));
});

test("a genuine branch deploy (branch-deploy context) is allowed -- checks keep working", () => {
  const branchHost = "feat-canonical-host--teachersbestfriend.netlify.app";
  assert.equal(H.hostRefusal(branchHost, { context: "branch-deploy", canonical: CANON }), null);
});

test("a deploy preview is allowed during PR checks", () => {
  const previewHost = "deploy-preview-42--teachersbestfriend.netlify.app";
  assert.equal(H.hostRefusal(previewHost, { context: "deploy-preview", canonical: CANON }), null);
});

test("localhost (dev, no context) is allowed", () => {
  assert.equal(H.hostRefusal("localhost:3000", { context: "", canonical: CANON }), null);
  assert.equal(H.hostRefusal("localhost:3000", { context: "dev", canonical: CANON }), null);
});

test("an unset canonical value fails loud in production, but stands down elsewhere", () => {
  // Troy's stated preference: production fails loud rather than silently
  // allowing every host. A loud outage is fixed in minutes; a silent
  // allow-everything is how a permalink runs unnoticed for nine days.
  assert.ok(
    H.hostRefusal("anything.example", { context: "production", canonical: "" }),
    "production with no canonical host must refuse",
  );
  // Outside production the value is expected to be unset, so there we allow.
  assert.equal(H.hostRefusal("anything.example", { context: "deploy-preview", canonical: "" }), null);
  assert.equal(H.hostRefusal("localhost:3000", { context: "", canonical: "" }), null);
  // A value that is only blanks/commas is still "unset" -> fail loud in prod.
  assert.ok(H.hostRefusal("anything.example", { context: "production", canonical: "  ,  " }));
});

test("normalizeHost tolerates how CANONICAL_HOST gets mis-entered, so a typo can't self-outage", () => {
  // All of these are the same host. A value entered with a scheme or a trailing
  // slash must still match, or production takes itself down on deploy with a
  // message blaming the visitor's address.
  const forms = [
    "teachersbestfriend.netlify.app",
    "https://teachersbestfriend.netlify.app",
    "http://teachersbestfriend.netlify.app",
    "teachersbestfriend.netlify.app/",
    "https://teachersbestfriend.netlify.app/",
    "https://teachersbestfriend.netlify.app/login?plan=tier1#top",
    "teachersbestfriend.netlify.app:443",
    "  teachersbestfriend.netlify.app  ",
    "TeachersBestFriend.Netlify.App",
    "teachersbestfriend.netlify.app.",
  ];
  for (const f of forms) {
    assert.equal(H.normalizeHost(f), CANON, `normalizeHost(${JSON.stringify(f)})`);
    // The same forms entered as the ENV value must still accept the real host.
    assert.equal(
      H.hostRefusal(CANON, { context: "production", canonical: f }),
      null,
      `CANONICAL_HOST=${JSON.stringify(f)} must accept the real host`,
    );
  }
});

test("a single-value CANONICAL_HOST behaves exactly as one host did", () => {
  assert.deepEqual(H.canonicalHosts(CANON), [CANON]);
  assert.equal(H.canonicalHost(CANON), CANON);
  assert.equal(H.hostRefusal(CANON, { context: "production", canonical: CANON }), null);
  assert.ok(H.hostRefusal("old--teachersbestfriend.netlify.app", { context: "production", canonical: CANON }));
});

test("two hosts: both are allowed, and the first is the redirect target", () => {
  // The .com switchover: both live at once, the new domain listed first.
  const list = "ateachersbestfriend.com, teachersbestfriend.netlify.app";
  assert.deepEqual(H.canonicalHosts(list), ["ateachersbestfriend.com", "teachersbestfriend.netlify.app"]);

  // Both accepted.
  assert.equal(H.hostRefusal("ateachersbestfriend.com", { context: "production", canonical: list }), null);
  assert.equal(H.hostRefusal("teachersbestfriend.netlify.app", { context: "production", canonical: list }), null);

  // A third host is refused, and the message names the FIRST (the new domain).
  const r = H.hostRefusal("old--teachersbestfriend.netlify.app", { context: "production", canonical: list });
  assert.ok(r && r.includes("https://ateachersbestfriend.com"), "refusal names the first host");

  // A stale bookmark on a non-canonical host is sent to the FIRST host.
  const target = H.canonicalRedirectTarget(
    { host: "old--teachersbestfriend.netlify.app", pathname: "/app", search: "?q=1", hash: "" },
    { context: "production", canonical: list },
  );
  assert.equal(target, "https://ateachersbestfriend.com/app?q=1");

  // But a request already on the second (still-allowed) host is left alone.
  assert.equal(
    H.canonicalRedirectTarget(
      { host: "teachersbestfriend.netlify.app", pathname: "/app", search: "", hash: "" },
      { context: "production", canonical: list },
    ),
    null,
  );
});

test("a messy two-host value parses cleanly", () => {
  const list = "  https://ateachersbestfriend.com/ ,  teachersbestfriend.netlify.app:443  ";
  assert.deepEqual(H.canonicalHosts(list), ["ateachersbestfriend.com", "teachersbestfriend.netlify.app"]);
  assert.equal(H.hostRefusal("teachersbestfriend.netlify.app", { context: "production", canonical: list }), null);
  assert.equal(H.hostRefusal("ateachersbestfriend.com", { context: "production", canonical: list }), null);
});

test("the client redirect target keeps the path and query, and is null on the canonical host", () => {
  const prevContext = process.env.CONTEXT;
  const prevCanon = process.env.CANONICAL_HOST;
  process.env.CONTEXT = "production";
  process.env.CANONICAL_HOST = CANON;
  try {
    const target = H.canonicalRedirectTarget({
      host: "6aa86be8b9484a000816ae63--teachersbestfriend.netlify.app",
      pathname: "/login",
      search: "?plan=tier1",
      hash: "",
    });
    assert.equal(target, `https://${CANON}/login?plan=tier1`);

    // On the canonical host there is nothing to do.
    assert.equal(
      H.canonicalRedirectTarget({ host: CANON, pathname: "/app", search: "", hash: "" }),
      null,
    );

    // On a deploy preview the redirect stands down even though the host differs.
    process.env.CONTEXT = "deploy-preview";
    assert.equal(
      H.canonicalRedirectTarget({
        host: "deploy-preview-42--teachersbestfriend.netlify.app",
        pathname: "/",
        search: "",
        hash: "",
      }),
      null,
    );
  } finally {
    if (prevContext === undefined) delete process.env.CONTEXT;
    else process.env.CONTEXT = prevContext;
    if (prevCanon === undefined) delete process.env.CANONICAL_HOST;
    else process.env.CANONICAL_HOST = prevCanon;
  }
});
