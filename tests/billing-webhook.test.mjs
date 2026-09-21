// What a Stripe event does to a teacher's plan.
//
// Every case here is one that costs somebody money when it is wrong, and none
// of them are things you want to discover by watching a real card get charged:
// an out-of-order event rolling a teacher back to a cheaper tier, a price we
// do not recognise quietly mapping to some default, a renewal date read from a
// field that stopped existing.
//
// The handler is split so this is possible at all: `decide()` takes an event
// and the subscription Stripe currently holds, and returns a row update. No
// network, no database, no clock it does not get told about.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";
import path from "node:path";

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
    external: ["stripe"],
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

const logic = bundle("lib/billing/webhook-logic.ts");
const config = bundle("lib/billing/config.ts");

// A fully configured deployment, passed explicitly so no test depends on what
// happens to be in process.env.
const ENV = {
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: "whsec_x",
  STRIPE_PRICE_TIER1: "price_tier1",
  STRIPE_PRICE_TIER2: "price_tier2",
  STRIPE_PRICE_TIER3: "price_tier3",
};

const NOW = new Date("2026-10-15T12:00:00Z");

/** A subscription as Stripe returns it in the pinned API version. */
function subscription({
  id = "sub_1",
  status = "active",
  price = "price_tier1",
  customer = "cus_1",
  teacher = "teacher-uuid",
  periodStart = Date.UTC(2026, 9, 1) / 1000,
  periodEnd = Date.UTC(2026, 10, 1) / 1000,
  items = undefined,
} = {}) {
  return {
    id,
    status,
    customer,
    metadata: teacher ? { teacher_id: teacher } : {},
    items: items ?? {
      data: [
        {
          id: "si_1",
          price: { id: price },
          // NOT on the subscription. This is the whole point of the fixture.
          current_period_start: periodStart,
          current_period_end: periodEnd,
        },
      ],
    },
  };
}

const event = (type, object = {}) => ({ id: "evt_1", type, data: { object } });

// ---------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------

test("billing is off unless every key is present", () => {
  assert.equal(config.billingEnabled(ENV), true);
  for (const key of Object.keys(ENV)) {
    const partial = { ...ENV };
    delete partial[key];
    // Half-configured is the dangerous state: a secret key with no webhook
    // secret takes money and never hears that it worked.
    assert.equal(config.billingEnabled(partial), false, `${key} should be required`);
    assert.deepEqual(config.missingBillingEnv(partial), [key]);
  }
});

test("an empty string is not a configured key", () => {
  // Netlify hands back "" for a variable that exists but was never filled in.
  assert.equal(config.billingEnabled({ ...ENV, STRIPE_PRICE_TIER2: "" }), false);
  assert.equal(config.billingEnabled({ ...ENV, STRIPE_PRICE_TIER2: "   " }), false);
});

test("a price maps to exactly one plan, and an unknown price maps to none", () => {
  assert.equal(config.planForPrice("price_tier1", ENV), "tier1");
  assert.equal(config.planForPrice("price_tier3", ENV), "tier3");
  assert.equal(config.planForPrice("price_somethingelse", ENV), null);
  assert.equal(config.planForPrice(null, ENV), null);
  assert.equal(config.planForPrice("", ENV), null);
});

// ---------------------------------------------------------------
// The period field that moved
// ---------------------------------------------------------------

test("the billing period is read from the subscription item, not the subscription", () => {
  const sub = subscription({});
  // Belt and braces: the fixture must not be accidentally passing because the
  // field is also on the subscription.
  assert.equal(sub.current_period_end, undefined);
  const period = logic.subscriptionPeriod(sub);
  assert.deepEqual(period, { start: "2026-10-01", end: "2026-11-01" });
});

test("a subscription with no item is refused outright", () => {
  // No item means neither a price nor a period. The price check happens to
  // fire first; what matters is that nothing is written and nothing is
  // guessed at.
  const d = logic.decide(
    event("customer.subscription.updated"),
    subscription({ items: { data: [] } }),
    NOW,
    ENV,
  );
  assert.equal(d.action, "fail");
  assert.equal(d.row, undefined);
});

test("a known price with no period is refused rather than written as null", () => {
  const d = logic.decide(
    event("customer.subscription.updated"),
    subscription({
      items: { data: [{ id: "si_1", price: { id: "price_tier1" } }] },
    }),
    NOW,
    ENV,
  );
  // The price is fine here, so this is the period check firing on its own: a
  // renewal date written as null is a teacher whose scans reset at a moment
  // nobody chose.
  assert.equal(d.action, "fail");
  assert.match(d.reason, /no billing period/);
});

// ---------------------------------------------------------------
// The ordinary path
// ---------------------------------------------------------------

test("checkout completed puts the teacher on the plan they bought", () => {
  const d = logic.decide(
    event("checkout.session.completed", {
      client_reference_id: "teacher-uuid",
      subscription: "sub_1",
      customer: "cus_1",
    }),
    subscription({ price: "price_tier1" }),
    NOW,
    ENV,
  );
  assert.equal(d.action, "write");
  assert.equal(d.teacherId, "teacher-uuid");
  assert.deepEqual(d.row, {
    plan_id: "tier1",
    status: "active",
    stripe_customer_id: "cus_1",
    stripe_subscription_id: "sub_1",
    current_period_start: "2026-10-01",
    current_period_end: "2026-11-01",
  });
});

test("an upgrade moves the plan and the period together", () => {
  const d = logic.decide(
    event("customer.subscription.updated"),
    subscription({
      price: "price_tier2",
      periodStart: Date.UTC(2026, 9, 15) / 1000,
      periodEnd: Date.UTC(2026, 10, 15) / 1000,
    }),
    NOW,
    ENV,
  );
  assert.equal(d.row.plan_id, "tier2");
  assert.equal(d.row.current_period_start, "2026-10-15");
  assert.equal(d.row.current_period_end, "2026-11-15");
});

test("a downgrade is just as ordinary as an upgrade", () => {
  const d = logic.decide(
    event("customer.subscription.updated"),
    subscription({ price: "price_tier1" }),
    NOW,
    ENV,
  );
  assert.equal(d.row.plan_id, "tier1");
});

test("invoice.paid keeps the teacher where the subscription says they are", () => {
  const d = logic.decide(
    event("invoice.paid", { customer: "cus_1" }),
    subscription({ price: "price_tier3" }),
    NOW,
    ENV,
  );
  assert.equal(d.row.plan_id, "tier3");
  assert.equal(d.row.status, "active");
});

// ---------------------------------------------------------------
// Out of order
// ---------------------------------------------------------------

test("an older event arriving late does NOT roll the plan back", () => {
  // The teacher upgraded to tier2. Stripe then delivers a stale `updated`
  // event whose own payload still describes tier1 -- events are not ordered.
  // Because the handler acts on the subscription it just retrieved, and not on
  // the event's snapshot, the late event is harmless.
  const staleEvent = event("customer.subscription.updated", {
    id: "sub_1",
    items: { data: [{ price: { id: "price_tier1" } }] },
    status: "active",
  });
  const whatStripeHoldsNow = subscription({ price: "price_tier2" });
  const d = logic.decide(staleEvent, whatStripeHoldsNow, NOW, ENV);
  assert.equal(
    d.row.plan_id,
    "tier2",
    "the retrieved state must win over the event payload",
  );
});

test("the event payload is never the source of the plan", () => {
  // Same shape, opposite direction: a NEWER-looking payload must not win
  // either. Only the retrieved subscription decides.
  const richEvent = event("customer.subscription.updated", {
    id: "sub_1",
    items: { data: [{ price: { id: "price_tier3" } }] },
  });
  const d = logic.decide(richEvent, subscription({ price: "price_tier1" }), NOW, ENV);
  assert.equal(d.row.plan_id, "tier1");
});

// ---------------------------------------------------------------
// Things going wrong
// ---------------------------------------------------------------

test("an unknown price id fails loudly and is never mapped to a plan", () => {
  const d = logic.decide(
    event("customer.subscription.updated"),
    subscription({ price: "price_from_another_account" }),
    NOW,
    ENV,
  );
  assert.equal(d.action, "fail");
  assert.match(d.reason, /unknown price id price_from_another_account/);
  // No row at all -- not a row with a default plan on it.
  assert.equal(d.row, undefined);
});

test("a failed payment keeps the plan and marks it past_due", () => {
  // The teacher has already paid for this period. Cutting off their quota over
  // a card that will probably work on the second attempt is the worse failure.
  const d = logic.decide(
    event("invoice.payment_failed", { customer: "cus_1" }),
    subscription({ price: "price_tier2", status: "past_due" }),
    NOW,
    ENV,
  );
  assert.equal(d.row.plan_id, "tier2");
  assert.equal(d.row.status, "past_due");
  assert.equal(d.row.stripe_subscription_id, "sub_1");
});

test("cancellation hands the row back to the free plan and the period roller", () => {
  const d = logic.decide(
    event("customer.subscription.deleted"),
    subscription({ status: "canceled" }),
    NOW,
    ENV,
  );
  assert.equal(d.row.plan_id, "free");
  assert.equal(d.row.status, "canceled");
  // Clearing the id is what re-enables roll_expired_billing_periods, which
  // only moves rows that Stripe does not manage.
  assert.equal(d.row.stripe_subscription_id, null);
  // Reset to the calendar month so the teacher has a live window immediately.
  assert.equal(d.row.current_period_start, "2026-10-01");
  assert.equal(d.row.current_period_end, "2026-11-01");
  // The customer is kept: they may come back, and the portal needs it.
  assert.equal(d.row.stripe_customer_id, "cus_1");
});

test("a subscription Stripe reports as canceled is treated as cancelled however it arrived", () => {
  const d = logic.decide(
    event("customer.subscription.updated"),
    subscription({ status: "canceled" }),
    NOW,
    ENV,
  );
  assert.equal(d.row.plan_id, "free");
  assert.equal(d.row.stripe_subscription_id, null);
});

test("an event type we did not ask for is ignored, not failed", () => {
  const d = logic.decide(event("customer.created"), subscription({}), NOW, ENV);
  assert.equal(d.action, "ignore");
});

test("a subscription event with nothing to retrieve is ignored", () => {
  const d = logic.decide(event("invoice.paid", { customer: "cus_1" }), null, NOW, ENV);
  assert.equal(d.action, "ignore");
});

// ---------------------------------------------------------------
// Finding the teacher and the subscription
// ---------------------------------------------------------------

test("checkout carries the teacher id we set on it", () => {
  assert.equal(
    logic.teacherIdFrom(
      event("checkout.session.completed", { client_reference_id: "t-1" }),
      null,
    ),
    "t-1",
  );
  assert.equal(
    logic.teacherIdFrom(
      event("checkout.session.completed", { metadata: { teacher_id: "t-2" } }),
      null,
    ),
    "t-2",
  );
});

test("a subscription carries the teacher id in its metadata", () => {
  assert.equal(
    logic.teacherIdFrom(event("customer.subscription.updated"), subscription({ teacher: "t-3" })),
    "t-3",
  );
});

test("an invoice carries no teacher id, so the caller must look it up", () => {
  // This is why the route falls back to stripe_customer_id.
  assert.equal(
    logic.teacherIdFrom(event("invoice.paid", { customer: "cus_9" }), subscription({ teacher: null })),
    null,
  );
  assert.equal(logic.customerIdFrom(event("invoice.paid", { customer: "cus_9" })), "cus_9");
});

test("the subscription id is found on every shape of event we handle", () => {
  assert.equal(
    logic.subscriptionIdFrom(event("checkout.session.completed", { subscription: "sub_a" })),
    "sub_a",
  );
  assert.equal(
    logic.subscriptionIdFrom(event("checkout.session.completed", { subscription: { id: "sub_b" } })),
    "sub_b",
  );
  assert.equal(
    logic.subscriptionIdFrom(event("customer.subscription.updated", { id: "sub_c" })),
    "sub_c",
  );
  // Invoices moved the subscription pointer around between API versions, so
  // all three places are tried.
  assert.equal(logic.subscriptionIdFrom(event("invoice.paid", { subscription: "sub_d" })), "sub_d");
  assert.equal(
    logic.subscriptionIdFrom(
      event("invoice.paid", { parent: { subscription_details: { subscription: "sub_e" } } }),
    ),
    "sub_e",
  );
  assert.equal(
    logic.subscriptionIdFrom(event("invoice.paid", { lines: { data: [{ subscription: "sub_f" }] } })),
    "sub_f",
  );
  assert.equal(logic.subscriptionIdFrom(event("invoice.paid", {})), null);
});

// ---------------------------------------------------------------
// The signature is the authentication
// ---------------------------------------------------------------

test("a valid signature is accepted and a tampered body is rejected", async () => {
  const Stripe = require("stripe");
  const stripe = new Stripe("sk_test_dummy", { apiVersion: "2026-08-26.dahlia" });
  const secret = "whsec_test_secret";
  const payload = JSON.stringify({ id: "evt_sig", type: "invoice.paid", data: { object: {} } });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });

  const ok = stripe.webhooks.constructEvent(payload, header, secret);
  assert.equal(ok.id, "evt_sig");

  // One byte different. The webhook route has no login and no origin check --
  // this is the only thing standing between the endpoint and anyone who knows
  // the URL, so it has to reject a body that was edited in flight.
  const tampered = payload.replace("invoice.paid", "invoice.void");
  assert.throws(
    () => stripe.webhooks.constructEvent(tampered, header, secret),
    /signature/i,
  );
  // And a signature made with a different secret.
  const wrong = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_other" });
  assert.throws(() => stripe.webhooks.constructEvent(payload, wrong, secret), /signature/i);
});

test("the pinned API version is the one the period fixture was written against", () => {
  // If this is bumped without re-checking subscriptionPeriod(), the renewal
  // date can silently start coming back undefined again.
  const src = bundleSource("lib/billing/stripe.ts");
  assert.match(src, /STRIPE_API_VERSION = "2026-08-26\.dahlia"/);
});

function bundleSource(entry) {
  return buildSync({
    entryPoints: [entry],
    bundle: false,
    write: false,
    absWorkingDir: ROOT,
    loader: { ".ts": "ts" },
  }).outputFiles[0].text;
}
