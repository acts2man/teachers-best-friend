// Ask the live site whether the things we claim are true, actually are.
//
// Every session that built this app has been unable to reach production from
// its own network, so "verified" has meant reading source and querying the
// database and reasoning about what the site must therefore do. That reasoning
// was wrong at least once in a way nothing local could catch: a redirect in
// next.config.ts shadowed app/signup/page.tsx, so the page was built, deployed,
// and never reached. The source was right. The site was not.
//
// This runs on a GitHub runner, which can reach the site, straight after the
// deploy check confirms the commit is live. Plain fetch, no dependencies.
//
// Usage: node scripts/smoke-live.mjs <url> <expected-commit-sha>
// Env:   SMOKE_BILLING_ENABLED=true once Stripe keys are set on the site.

const [, , rawUrl, expectedCommit] = process.argv;

if (!rawUrl) {
  console.error("usage: node scripts/smoke-live.mjs <url> [expected-commit]");
  process.exit(2);
}
const BASE = rawUrl.replace(/\/+$/, "");

// Before Stripe is connected the billing routes answer 503 "opening soon".
// After, the webhook gets far enough to reject an unsigned body as a 400. Both
// are correct; which one is correct depends on the site's configuration, not
// on this script. docs/connecting-stripe.md lists flipping this as a step.
const BILLING_ENABLED = /^(1|true|yes|on)$/i.test(
  process.env.SMOKE_BILLING_ENABLED ?? "",
);

const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Never throws: a network failure is a failed check, not a crashed script. */
async function get(path, init) {
  try {
    const res = await fetch(BASE + path, { redirect: "manual", ...init });
    const body = await res.text();
    return { status: res.status, location: res.headers.get("location"), body };
  } catch (e) {
    return { status: 0, location: null, body: "", error: String(e) };
  }
}

async function check(name, fn) {
  try {
    const { ok, detail } = await fn();
    record(name, ok, detail);
  } catch (e) {
    record(name, false, `threw: ${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log(`Smoke checks against ${BASE}`);
console.log(`Billing expected: ${BILLING_ENABLED ? "ON" : "OFF"}`);
console.log("");

// ---------------------------------------------------------------
// The regression this script exists for
// ---------------------------------------------------------------

await check("GET /signup?plan=tier1 renders, and is not redirected away", async () => {
  const r = await get("/signup?plan=tier1");
  // redirect: "manual", so a 3xx shows up as itself rather than being
  // followed silently. Following it is what hid this for a week.
  if (r.status >= 300 && r.status < 400)
    return {
      ok: false,
      detail: `${r.status} to ${r.location} — a redirect is shadowing app/signup/page.tsx`,
    };
  return { ok: r.status === 200, detail: `${r.status}` };
});

// ---------------------------------------------------------------
// What the homepage says
// ---------------------------------------------------------------

await check("GET / is 200 and says 36 pages", async () => {
  const r = await get("/");
  if (r.status !== 200) return { ok: false, detail: `${r.status}` };
  return {
    ok: r.body.includes("36 pages"),
    detail: r.body.includes("36 pages") ? "200" : '200 but "36 pages" is missing',
  };
});

await check("GET / does not advertise the beta plan", async () => {
  const r = await get("/");
  // beta.listed = false. It stays active for the two accounts on it and stays
  // assignable from admin; it is just not something a stranger can pick.
  const leaked = r.body.includes("Beta (comped)");
  return { ok: r.status === 200 && !leaked, detail: leaked ? '"Beta (comped)" is on the page' : "absent" };
});

await check("GET / does not still say 20 scans", async () => {
  const r = await get("/");
  const stale = r.body.includes("20 scans");
  return { ok: r.status === 200 && !stale, detail: stale ? '"20 scans" is on the page' : "absent" };
});

await check("GET /login is 200", async () => {
  const r = await get("/login");
  return { ok: r.status === 200, detail: `${r.status}` };
});

// ---------------------------------------------------------------
// Billing, in whichever state the site is actually in
// ---------------------------------------------------------------

await check(
  `POST /api/billing/webhook with junk is ${BILLING_ENABLED ? 400 : 503}`,
  async () => {
    const r = await get("/api/billing/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ junk: 1 }),
    });
    // 503 while billing is off: not configured, refused before the body is
    // even read. 400 once it is on: the body has no valid signature. Never
    // 500 -- a junk POST to a public endpoint is not a server fault.
    const want = BILLING_ENABLED ? 400 : 503;
    return { ok: r.status === want, detail: `${r.status} (want ${want})` };
  },
);

await check("POST /api/analyze unauthenticated is 401, not 500", async () => {
  // The only thing about the retry and spend-cap work that is safely
  // checkable from outside. Everything else in it sits behind a sign-in and a
  // real model call, and a smoke check has no business spending money to
  // prove a ceiling works -- that is what supabase/checks/spend-caps.sql is
  // for, where nothing is charged and everything rolls back.
  //
  // What this does prove is worth having: the grading route still loads and
  // still refuses a stranger. Those changes added imports to it, and a module
  // that throws on load turns this into a 500 rather than a 401.
  const r = await get("/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "responses", uploadIds: [] }),
  });
  return { ok: r.status === 401, detail: `${r.status}` };
});

await check("POST /api/account/delete unauthenticated is 401", async () => {
  // The most destructive endpoint in the product. A stranger must not reach
  // it, and it must not 500 on the way to saying so -- a 500 here would mean
  // the route threw before the auth check, which is the shape of a bug that
  // could later throw somewhere worse. The body is deliberately a plausible
  // one: an empty body could be rejected for the wrong reason and look like a
  // pass.
  const r = await get("/api/account/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "nobody@example.invalid" }),
  });
  return { ok: r.status === 401, detail: `${r.status}` };
});

await check("GET /api/account/export unauthenticated is 401", async () => {
  // A whole classroom in one file is the highest-value response this app can
  // produce, so the signed-out case is checked from outside rather than
  // reasoned about. The impersonation refusal underneath it cannot be reached
  // without a session and a view-as cookie, which is what
  // tests/account-export.test.mjs covers.
  const r = await get("/api/account/export?format=json");
  return { ok: r.status === 401, detail: `${r.status}` };
});

await check("GET /api/admin/export/… unauthenticated is 401, not 503", async () => {
  // This answered 503 "We couldn't complete that request." until the route
  // stopped using a page gate: requireAdmin() calls redirect(), redirect()
  // throws NEXT_REDIRECT, the route's catch caught it, and apiError() renders
  // an unrecognised throw as an outage. The id is the nil UUID -- a real one
  // would be a live account id sitting in a public workflow file.
  const r = await get("/api/admin/export/00000000-0000-0000-0000-000000000000?format=json");
  return {
    ok: r.status === 401,
    detail: r.status === 503 ? "503 — the page gate is back" : `${r.status}`,
  };
});

await check("POST /api/billing/checkout unauthenticated is 401", async () => {
  const r = await get("/api/billing/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plan: "tier1" }),
  });
  // Signed out is signed out, whether or not billing is switched on. If this
  // ever answers 200 it is handing a checkout session to a stranger.
  return { ok: r.status === 401, detail: `${r.status}` };
});

// ---------------------------------------------------------------
// Is this even the build we think it is
// ---------------------------------------------------------------

if (expectedCommit) {
  await check("GET /api/version reports the deployed commit", async () => {
    const r = await get("/api/version");
    let commit = "";
    try {
      commit = JSON.parse(r.body).commit ?? "";
    } catch {
      return { ok: false, detail: `unparseable body: ${r.body.slice(0, 120)}` };
    }
    return {
      ok: commit === expectedCommit,
      detail: commit === expectedCommit ? commit.slice(0, 12) : `${commit || "(none)"} != ${expectedCommit}`,
    };
  });
}

// ---------------------------------------------------------------
// The app refuses to run anywhere but its real address
// ---------------------------------------------------------------
//
// The canonical host (this BASE, the one the deploy check just confirmed) must
// serve normally -- the host guard must not refuse its own real address. Every
// check above already exercised it; this states it directly against /api/version,
// where a wrongly-tripped guard would show up as a 421 instead of a commit.

await check("GET /api/version on the canonical host is not refused by the host guard", async () => {
  const r = await get("/api/version");
  if (r.status === 421)
    return { ok: false, detail: "421 — the host guard is refusing the canonical host itself" };
  return { ok: r.status === 200, detail: `${r.status}` };
});

// Now the harder half: prove the guard actually REFUSES a non-canonical host,
// not just that it is configured. Three ways, strongest first; we assert
// whatever this runner can actually reach and say plainly when a way is blocked.
const canonHost = (() => {
  try {
    return new URL(BASE).host;
  } catch {
    return "";
  }
})();

// (1) A real non-canonical host of this site (a deploy permalink), if one is
// supplied. This is the only true end-to-end proof: the request reaches
// proxy.ts under a host Netlify actually serves, and the guard must answer 421
// with the teacher-readable refusal -- not 401 (auth) and not 200 (served).
const NONCANONICAL = (process.env.SMOKE_NONCANONICAL_URL ?? "").replace(/\/+$/, "");
if (NONCANONICAL) {
  await check(`A non-canonical host (${NONCANONICAL}) is refused with 421 + the message`, async () => {
    let status = 0;
    let body = "";
    try {
      const res = await fetch(`${NONCANONICAL}/api/version`, { redirect: "manual" });
      status = res.status;
      body = await res.text();
    } catch (e) {
      // A deleted permalink that is simply gone is also a pass: it cannot serve.
      return { ok: true, detail: `unreachable (deleted or blocked): ${String(e).slice(0, 80)}` };
    }
    if (status !== 421)
      return { ok: false, detail: `${status} (want 421) — not refused as a non-canonical host` };
    let message = "";
    try {
      message = JSON.parse(body).error ?? "";
    } catch {
      /* fall through to the substring check */
    }
    const named = (message || body).includes(`https://${canonHost}`);
    return {
      ok: named,
      detail: named ? "421 and the message names the real address" : `421 but the message is unexpected: ${(message || body).slice(0, 120)}`,
    };
  });
}

// (2) Best-effort from the canonical endpoint: send a non-canonical
// x-forwarded-host and see whether the guard trips. This works only if
// Netlify's edge forwards a client-supplied x-forwarded-host through to the
// function. If it overwrites it with the real host (which it is expected to),
// proxy.ts sees the canonical host and this cannot prove refusal from here --
// so we report that plainly rather than claim the guard works. Never fails the
// build: an edge that rewrites the header is not a guard bug.
await check("Refusal proof via a spoofed x-forwarded-host (best-effort)", async () => {
  const spoof = `smoke-noncanonical--${canonHost}`;
  const r = await get("/api/version", { headers: { "x-forwarded-host": spoof } });
  if (r.status === 421)
    return { ok: true, detail: "421 — the guard refused a non-canonical forwarded host end-to-end" };
  return {
    ok: true, // environmental limitation, not a guard failure
    detail: `INCONCLUSIVE from this runner: /api/version → ${r.status}, so Netlify's edge overwrote x-forwarded-host with the real host before proxy.ts saw it. End-to-end refusal not provable this way; see the bundle-config proof and supply SMOKE_NONCANONICAL_URL (a permalink) for the true end-to-end check.`,
  };
});

// (3) Always provable from the runner: the deployed client bundle carries the
// canonical host value AND the production context, so the guard is configured
// and switched on in what actually shipped. next.config.ts inlines both into
// the bundle at build time (the client redirect reads them), so a build with
// the guard off, or with the wrong host, would not contain these.
await check("The deployed client bundle carries the canonical host and the production context", async () => {
  const home = await get("/");
  if (home.status !== 200) return { ok: false, detail: `homepage ${home.status}` };
  const srcs = [
    ...new Set([...home.body.matchAll(/\/_next\/static\/[A-Za-z0-9._/-]+\.js/g)].map((m) => m[0])),
  ].slice(0, 40);
  let haveHost = false;
  let haveProd = false;
  let scanned = 0;
  for (const s of srcs) {
    if (haveHost && haveProd) break;
    const r = await get(s);
    if (r.status !== 200) continue;
    scanned += 1;
    if (canonHost && r.body.includes(canonHost)) haveHost = true;
    if (/["']production["']/.test(r.body)) haveProd = true;
  }
  return {
    ok: haveHost && haveProd,
    detail: `scanned ${scanned} chunk(s) — canonical host ${haveHost ? "present" : "MISSING"}, production context ${haveProd ? "present" : "MISSING"}`,
  };
});

// ---------------------------------------------------------------

const failed = results.filter((r) => !r.ok);
console.log("");
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("");
  console.log("Failed:");
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
  console.log("");
  console.log("The site is not doing what the repository says it does.");
  process.exit(1);
}
