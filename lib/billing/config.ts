/**
 * Whether billing is switched on, and which plan a Stripe price belongs to.
 *
 * Deliberately pure and free of imports: no `server-only`, no Stripe client, no
 * database. It is the one place that decides "can we take money today", and it
 * has to be readable by the routes, the UI and the tests without any of them
 * dragging in the others.
 *
 * There is no Stripe account yet. Everything here is written so that the day
 * there is one, turning it on is five environment variables and a redeploy --
 * no code change, no migration, nothing to remember.
 */

/** The plans a teacher can actually buy. `free` and `beta` are not sold. */
export const PAID_PLANS = ["tier1", "tier2", "tier3"] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];

export function isPaidPlan(value: unknown): value is PaidPlan {
  return typeof value === "string" && (PAID_PLANS as readonly string[]).includes(value);
}

/**
 * The environment this module reads. Passed in rather than reached for, so a
 * test can describe a half-configured deployment without touching process.env
 * and leaking that state into the next test.
 */
export type BillingEnv = {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_TIER1?: string;
  STRIPE_PRICE_TIER2?: string;
  STRIPE_PRICE_TIER3?: string;
};

const REQUIRED: (keyof BillingEnv)[] = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_TIER1",
  "STRIPE_PRICE_TIER2",
  "STRIPE_PRICE_TIER3",
];

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * All five, or none of it.
 *
 * Partial configuration is the dangerous state: a secret key with no webhook
 * secret takes a teacher's money and never hears that it worked, so they pay
 * and stay on the free plan. A price id missing for one tier is a checkout
 * button that 500s for whoever picks that tier. Neither is allowed to be a
 * thing that happens -- billing is either fully configured or off.
 */
export function billingEnabled(env: BillingEnv = process.env as BillingEnv): boolean {
  return REQUIRED.every((key) => clean(env[key]) !== undefined);
}

/** Which keys are missing, for an operator reading logs. Never shown to a teacher. */
export function missingBillingEnv(env: BillingEnv = process.env as BillingEnv): string[] {
  return REQUIRED.filter((key) => clean(env[key]) === undefined);
}

/**
 * plan -> price id. Built from the environment every call rather than cached,
 * so switching a deployment from test mode to live mode is an env change and a
 * restart, with nothing stale held in module scope.
 */
export function priceForPlan(
  plan: PaidPlan,
  env: BillingEnv = process.env as BillingEnv,
): string | undefined {
  return clean(
    plan === "tier1"
      ? env.STRIPE_PRICE_TIER1
      : plan === "tier2"
        ? env.STRIPE_PRICE_TIER2
        : env.STRIPE_PRICE_TIER3,
  );
}

/**
 * price id -> plan. The direction that matters on the way in from Stripe.
 *
 * Returns null for anything unrecognised. It must never fall back to a plan:
 * an unknown price mapped to `tier1` by a default would hand someone the wrong
 * quota for the wrong money, and it would look like it worked. The caller logs
 * it and refuses to write.
 *
 * Unrecognised is a real situation, not a theoretical one: a price created in
 * the Stripe dashboard but never put in the env, or a live-mode price arriving
 * at a deployment still holding test-mode ids.
 */
export function planForPrice(
  priceId: string | null | undefined,
  env: BillingEnv = process.env as BillingEnv,
): PaidPlan | null {
  const id = clean(priceId ?? undefined);
  if (!id) return null;
  for (const plan of PAID_PLANS) if (priceForPlan(plan, env) === id) return plan;
  return null;
}

/** The message a teacher sees anywhere billing is not switched on yet. */
export const BILLING_DISABLED_MESSAGE =
  "Paid plans are opening soon. Your free account keeps working in the meantime.";
