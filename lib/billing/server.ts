import "server-only";
import type Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase/service";
import { HttpError } from "@/lib/http-error";
import { stripeClient } from "./stripe";

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * The teacher's billing row, as the routes need it.
 *
 * Read through the service client rather than the teacher's own session: the
 * routes here act on behalf of a teacher we have already authenticated, and
 * one of them (the webhook) has no session at all.
 */
export type BillingState = {
  planId: string;
  status: string;
  customerId: string | null;
  subscriptionId: string | null;
  periodStart: string;
  periodEnd: string;
};

export async function readBilling(
  svc: ServiceClient,
  teacher: string,
): Promise<BillingState | null> {
  const { data, error } = await svc
    .from("subscriptions")
    .select(
      "plan_id, status, stripe_customer_id, stripe_subscription_id, current_period_start, current_period_end",
    )
    .eq("teacher_id", teacher)
    .maybeSingle();
  if (error) {
    console.error("Reading subscription failed", error.message);
    throw new HttpError(500, "Couldn’t load your plan. Please try again.");
  }
  if (!data) return null;
  return {
    planId: data.plan_id as string,
    status: data.status as string,
    customerId: (data.stripe_customer_id as string | null) ?? null,
    subscriptionId: (data.stripe_subscription_id as string | null) ?? null,
    periodStart: data.current_period_start as string,
    periodEnd: data.current_period_end as string,
  };
}

/**
 * A teacher already paying is not allowed to start a second checkout.
 *
 * This is the one place double billing would happen. Stripe will happily give
 * one customer two active subscriptions to the same price and charge for both,
 * and nothing downstream would notice: `subscriptions` holds one row per
 * teacher, so the second webhook simply overwrites the first and the extra
 * subscription becomes invisible while continuing to bill every month.
 *
 * `past_due` counts as already subscribed on purpose. A teacher whose card
 * bounced is mid-retry, not unsubscribed -- sending them to checkout would add
 * a second subscription alongside the one Stripe is still trying to collect.
 * They go to the portal, where fixing the card is the actual repair.
 */
export function alreadySubscribed(state: BillingState | null): boolean {
  return Boolean(
    state?.subscriptionId && (state.status === "active" || state.status === "past_due"),
  );
}

/**
 * The teacher's Stripe customer, created once and remembered.
 *
 * Written to the row immediately, before checkout is created. If the teacher
 * abandons checkout we have a customer with no subscription, which costs
 * nothing and is reused next time. The opposite order -- checkout first, store
 * the customer when the webhook arrives -- makes a second attempt create a
 * second customer, and then the portal has to guess which one to open.
 */
export async function customerFor(
  svc: ServiceClient,
  teacher: string,
  email: string | null,
  state: BillingState | null,
): Promise<string> {
  if (state?.customerId) return state.customerId;
  const stripe = stripeClient();
  const customer = await stripe.customers.create({
    email: email ?? undefined,
    metadata: { teacher_id: teacher },
  });
  const { error } = await svc
    .from("subscriptions")
    .update({ stripe_customer_id: customer.id, updated_at: new Date().toISOString() })
    .eq("teacher_id", teacher);
  if (error) {
    console.error("Storing stripe customer failed", error.message);
    throw new HttpError(500, "Couldn’t start checkout. Please try again.");
  }
  return customer.id;
}

/**
 * Retrieves the subscription Stripe holds right now.
 *
 * Every webhook path goes through this rather than reading the snapshot inside
 * the event, because events do not arrive in the order they happened. Expanded
 * so the items -- which is where the billing period lives in the pinned API
 * version -- come back with it.
 */
export async function retrieveSubscription(
  id: string,
): Promise<Stripe.Subscription | null> {
  try {
    return await stripeClient().subscriptions.retrieve(id, {
      expand: ["items.data.price"],
    });
  } catch (e) {
    console.error(
      "Retrieving subscription failed",
      id,
      e instanceof Error ? e.message : String(e),
    );
    return null;
  }
}
