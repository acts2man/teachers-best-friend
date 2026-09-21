// With no Stripe account, nothing about billing may break.
//
// This is the state the app is actually in today and will be in until the
// founders open a Stripe account, so it is the state that has to be right
// first. The failure to avoid is a button that looks live, takes a teacher's
// click, and hands back a 500 -- or worse, a checkout that half works.
//
// Everything here is checked against the real route modules, with the
// environment emptied, rather than against a description of what they should
// do.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";
import path from "node:path";
import fs from "node:fs";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);

const BILLING_KEYS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_TIER1",
  "STRIPE_PRICE_TIER2",
  "STRIPE_PRICE_TIER3",
];

function withoutStripeEnv(run) {
  const saved = {};
  for (const k of BILLING_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  try {
    return run();
  } finally {
    for (const k of BILLING_KEYS)
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
  }
}

function bundle(entry) {
  const r = buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    absWorkingDir: ROOT,
    alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
    external: ["stripe"],
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

const config = bundle("lib/billing/config.ts");

test("with no keys at all, billing is off", () => {
  withoutStripeEnv(() => {
    assert.equal(config.billingEnabled(), false);
    assert.deepEqual(config.missingBillingEnv(), BILLING_KEYS);
  });
});

test("the message a teacher sees says what is true and what still works", () => {
  // Not an error, and not a promise with a date on it.
  assert.match(config.BILLING_DISABLED_MESSAGE, /opening soon/i);
  assert.match(config.BILLING_DISABLED_MESSAGE, /free account keeps working/i);
});

test("requireBilling refuses with 503 and the teacher message", () => {
  withoutStripeEnv(() => {
    const stripeModule = bundle("lib/billing/stripe.ts");
    let thrown;
    try {
      stripeModule.requireBilling();
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown, "requireBilling should refuse");
    assert.equal(thrown.status, 503);
    assert.equal(thrown.message, config.BILLING_DISABLED_MESSAGE);
  });
});

test("asking for the Stripe client while disabled refuses rather than building a broken one", () => {
  withoutStripeEnv(() => {
    const stripeModule = bundle("lib/billing/stripe.ts");
    // A half-built client is the thing that would take a payment and never
    // confirm it. There is no such object to hand out.
    assert.throws(() => stripeModule.stripeClient(), (e) => e.status === 503);
  });
});

// ---------------------------------------------------------------
// The routes themselves
// ---------------------------------------------------------------

/**
 * Read as source rather than executed: the route modules pull in next/headers
 * and a Supabase client, which need a request and a running server. What is
 * being checked is structural -- that the guard is there, before anything that
 * could reach Stripe.
 */
function routeSource(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

test("checkout and portal guard before they do anything else", () => {
  for (const file of [
    "app/api/billing/checkout/route.ts",
    "app/api/billing/portal/route.ts",
  ]) {
    const src = routeSource(file);
    assert.match(src, /requireBilling\(\)/, `${file} must call requireBilling`);
    // The guard has to come before the Stripe client is ever asked for,
    // otherwise the 503 arrives as a crash instead of a sentence.
    assert.ok(
      src.indexOf("requireBilling()") < src.indexOf("stripeClient()"),
      `${file}: requireBilling must come before stripeClient`,
    );
  }
});

test("the webhook refuses while billing is disabled, and refuses before reading the body", () => {
  const src = routeSource("app/api/billing/webhook/route.ts");
  assert.match(src, /if \(!billingEnabled\(\)/);
  assert.ok(
    src.indexOf("billingEnabled()") < src.indexOf("request.text()"),
    "the disabled check must come before the body is read",
  );
  // 503, not 500: a junk POST to a disabled endpoint is not a server fault.
  assert.match(src, /HttpError\(503, BILLING_DISABLED_MESSAGE\)/);
});

test("the webhook reads the raw body, never parsed JSON", () => {
  const src = routeSource("app/api/billing/webhook/route.ts");
  // Stripe signs the exact bytes. request.json() and back through stringify
  // reorders keys and every signature fails.
  assert.match(src, /await request\.text\(\)/);
  assert.ok(!/await request\.json\(\)/.test(src), "must not parse the body before verifying");
});

test("the webhook records the event before doing any work", () => {
  const src = routeSource("app/api/billing/webhook/route.ts");
  assert.ok(
    src.indexOf("claimEvent(") < src.indexOf("await handle("),
    "the event must be claimed before it is handled",
  );
});

test("the billing state route still answers while billing is off", () => {
  // The page has to be able to render "Opening soon". A state route that 503s
  // would leave a teacher looking at an error instead of at the plans.
  const src = routeSource("app/api/billing/state/route.ts");
  assert.match(src, /billingEnabled: billingEnabled\(\)/);
  assert.ok(
    !/requireBilling\(\)/.test(src),
    "state must not refuse when billing is disabled",
  );
});

test("the billing page disables the buttons instead of hiding the plans", () => {
  const src = routeSource("components/teacher-billing.tsx");
  assert.match(src, /Opening soon/);
  assert.match(src, /disabled=\{!enabled/);
});

test("the checkout route never takes a price from the request body", () => {
  const src = routeSource("app/api/billing/checkout/route.ts");
  // The body is a plan name and nothing else; the price is looked up from the
  // environment. A body that could name its own price could name $0.00.
  assert.match(src, /z\.object\(\{ plan: z\.enum\(PAID_PLANS\) \}\)/);
  assert.match(src, /priceForPlan\(plan\)/);
});

test("the checkout route refuses a second subscription", () => {
  const src = routeSource("app/api/billing/checkout/route.ts");
  assert.match(src, /alreadySubscribed\(state\)/);
  assert.match(src, /Manage billing/);
});

test("past_due counts as already subscribed", () => {
  const server = fs.readFileSync(path.join(ROOT, "lib/billing/server.ts"), "utf8");
  // A bounced card is mid-retry, not unsubscribed. Sending that teacher to
  // checkout would add a second subscription beside the one Stripe is still
  // collecting.
  assert.match(server, /status === "active" \|\| state\.status === "past_due"/);
});
