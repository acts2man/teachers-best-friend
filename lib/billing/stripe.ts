import "server-only";
import Stripe from "stripe";
import { HttpError } from "@/lib/http-error";
import { BILLING_DISABLED_MESSAGE, billingEnabled, missingBillingEnv } from "./config";

/**
 * The one place the Stripe API version is pinned.
 *
 * Pinned rather than left to the library's default because the shape of the
 * objects changes between versions and this codebase reads specific fields out
 * of them -- see subscriptionPeriod() below, where the billing period moved off
 * the Subscription and onto its items. An unpinned client would silently start
 * speaking a different version on the next `npm install`, and the first sign of
 * it would be a teacher's renewal date going blank.
 */
export const STRIPE_API_VERSION = "2026-08-26.dahlia";

let client: Stripe | null = null;

/**
 * The Stripe client, or a 503 if billing is not configured.
 *
 * Never returns a half-built client. Every caller is a route that must answer
 * "not yet" cleanly rather than throw something a teacher would see as a
 * crash.
 */
export function stripeClient(): Stripe {
  if (!billingEnabled()) {
    console.error(
      "Stripe called while billing is disabled; missing:",
      missingBillingEnv().join(", "),
    );
    throw new HttpError(503, BILLING_DISABLED_MESSAGE);
  }
  if (!client)
    client = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
      apiVersion: STRIPE_API_VERSION,
    });
  return client;
}

/** Guard for the top of every billing route. */
export function requireBilling(): void {
  if (!billingEnabled()) throw new HttpError(503, BILLING_DISABLED_MESSAGE);
}

export { billingEnabled, missingBillingEnv, BILLING_DISABLED_MESSAGE };
