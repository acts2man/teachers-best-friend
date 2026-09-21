import type Stripe from "stripe";
import { planForPrice, type BillingEnv } from "./config";

/**
 * What a Stripe event means for a teacher's subscription row.
 *
 * Pure: an event and the subscription Stripe currently holds go in, a row
 * update comes out. No network, no database, no clock beyond what is handed
 * to it. That is what makes the cases below testable at all -- out-of-order
 * delivery, an unknown price, a cancellation -- none of which are things you
 * want to discover by watching real money move.
 *
 * `import type` only: this file compiles to no Stripe import at all.
 */

/** The columns a webhook is allowed to write on public.subscriptions. */
export type SubscriptionRow = {
  plan_id: string;
  status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_start: string;
  current_period_end: string;
};

export type Decision =
  | { action: "write"; row: SubscriptionRow; teacherId: string | null }
  | { action: "ignore"; reason: string }
  | { action: "fail"; reason: string };

/** Stripe hands out seconds; the subscriptions table stores dates. */
export function toDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

/**
 * The billing period, read from the subscription item.
 *
 * In the API version this codebase pins, `current_period_start` and
 * `current_period_end` are NOT on the Subscription any more -- they moved onto
 * each subscription item, because a subscription can hold items billed on
 * different schedules. Reading `subscription.current_period_end` compiles
 * (it is `any` through the SDK's index signatures in some shapes) and returns
 * undefined at run time, which lands in the database as a null renewal date.
 *
 * We sell one item per subscription, so the first item is the subscription's
 * period. If there is no item there is no period, and that is a failure rather
 * than a guess: a subscription row with the wrong window silently changes when
 * a teacher's scans reset.
 */
export function subscriptionPeriod(
  subscription: Stripe.Subscription,
): { start: string; end: string } | null {
  const item = subscription.items?.data?.[0] as
    | { current_period_start?: number; current_period_end?: number }
    | undefined;
  if (!item) return null;
  const { current_period_start: start, current_period_end: end } = item;
  if (typeof start !== "number" || typeof end !== "number") return null;
  return { start: toDate(start), end: toDate(end) };
}

/** The price a subscription is actually on, from its first item. */
export function subscriptionPriceId(subscription: Stripe.Subscription): string | null {
  return subscription.items?.data?.[0]?.price?.id ?? null;
}

function customerId(subscription: Stripe.Subscription): string | null {
  const c = subscription.customer;
  return typeof c === "string" ? c : (c?.id ?? null);
}

/** The calendar month, for handing a cancelled row back to the period roller. */
export function currentCalendarMonth(now: Date): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/**
 * Events that tell us something about a subscription. Everything else is
 * acknowledged and ignored -- Stripe will happily send an endpoint more than
 * it was asked for, and an unrecognised event is not an error.
 */
const SUBSCRIPTION_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
]);

export function isSubscriptionEvent(type: string): boolean {
  return SUBSCRIPTION_EVENTS.has(type);
}

/**
 * Decides what to write.
 *
 * `subscription` is what the caller just RETRIEVED from Stripe, never the
 * snapshot embedded in the event. That is the whole defence against
 * out-of-order delivery: Stripe does not promise events arrive in the order
 * they happened, so an `updated` event describing yesterday's tier1 can land
 * after today's tier2. Acting on the event's own payload would roll the
 * teacher back to the cheaper plan and the wrong quota. Acting on the state
 * Stripe holds right now cannot, however late the event is.
 *
 * `teacherId` comes from the event where the event carries it (checkout's
 * client_reference_id, or subscription metadata); otherwise the caller looks
 * the row up by stripe_customer_id.
 */
export function decide(
  event: { type: string; data: { object: unknown } },
  subscription: Stripe.Subscription | null,
  now: Date,
  env?: BillingEnv,
): Decision {
  if (!isSubscriptionEvent(event.type))
    return { action: "ignore", reason: `not a subscription event: ${event.type}` };

  if (!subscription)
    return {
      action: "ignore",
      reason: `${event.type} carried no subscription to act on`,
    };

  const teacherId = teacherIdFrom(event, subscription);

  // Cancelled: hand the row back to the free plan and to
  // roll_expired_billing_periods, which only moves rows with no Stripe
  // subscription on them. Clearing the id is what re-enables that.
  if (event.type === "customer.subscription.deleted" || subscription.status === "canceled") {
    const month = currentCalendarMonth(now);
    return {
      action: "write",
      teacherId,
      row: {
        plan_id: "free",
        status: "canceled",
        stripe_customer_id: customerId(subscription),
        stripe_subscription_id: null,
        current_period_start: month.start,
        current_period_end: month.end,
      },
    };
  }

  const priceId = subscriptionPriceId(subscription);
  const plan = planForPrice(priceId, env);
  if (!plan)
    // Never guess. A price we do not recognise mapped to some default would
    // hand out the wrong quota for the wrong money and look like it worked.
    return {
      action: "fail",
      reason: `unknown price id ${priceId ?? "(none)"} on subscription ${subscription.id}`,
    };

  const period = subscriptionPeriod(subscription);
  if (!period)
    return {
      action: "fail",
      reason: `subscription ${subscription.id} has no billing period on its items`,
    };

  // A failed payment keeps the plan and its quota while Stripe retries. The
  // teacher is mid-term and has already been charged for this period; cutting
  // them off over a card that will probably work on the second attempt is a
  // worse failure than carrying them. When the retries run out Stripe cancels
  // the subscription itself, and that arrives as `deleted` above.
  const status =
    event.type === "invoice.payment_failed" ? "past_due" : subscription.status;

  return {
    action: "write",
    teacherId,
    row: {
      plan_id: plan,
      status,
      stripe_customer_id: customerId(subscription),
      stripe_subscription_id: subscription.id,
      current_period_start: period.start,
      current_period_end: period.end,
    },
  };
}

/**
 * Who this belongs to, where the event says so.
 *
 * Checkout carries client_reference_id because we set it; subscriptions carry
 * metadata.teacher_id for the same reason. Invoices carry neither, so those
 * fall through to a lookup by customer id in the caller.
 */
export function teacherIdFrom(
  event: { type: string; data: { object: unknown } },
  subscription: Stripe.Subscription | null,
): string | null {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const ref = session.client_reference_id || session.metadata?.teacher_id;
    if (ref) return ref;
  }
  const meta = subscription?.metadata?.teacher_id;
  return meta || null;
}

/** The subscription id an event points at, so the caller knows what to retrieve. */
export function subscriptionIdFrom(event: {
  type: string;
  data: { object: unknown };
}): string | null {
  const object: unknown = event.data.object;
  if (event.type === "checkout.session.completed") {
    const s = (object as Stripe.Checkout.Session).subscription;
    return typeof s === "string" ? s : (s?.id ?? null);
  }
  if (event.type.startsWith("customer.subscription."))
    return (object as Stripe.Subscription).id ?? null;
  if (event.type.startsWith("invoice.")) {
    // An invoice points at its subscription through the line items in the
    // versions this pins; the top-level field was removed.
    const invoice = object as Stripe.Invoice & {
      subscription?: string | { id: string };
      parent?: { subscription_details?: { subscription?: string | { id: string } } };
    };
    const direct = invoice.subscription;
    if (direct) return typeof direct === "string" ? direct : direct.id;
    const parent = invoice.parent?.subscription_details?.subscription;
    if (parent) return typeof parent === "string" ? parent : parent.id;
    const line = invoice.lines?.data?.[0] as
      | { subscription?: string | { id: string } }
      | undefined;
    const fromLine = line?.subscription;
    if (fromLine) return typeof fromLine === "string" ? fromLine : fromLine.id;
  }
  return null;
}

/** The customer id an event points at, for looking a teacher up by it. */
export function customerIdFrom(event: {
  type: string;
  data: { object: unknown };
}): string | null {
  const object = event.data.object as { customer?: string | { id: string } | null };
  const c = object.customer;
  if (!c) return null;
  return typeof c === "string" ? c : c.id;
}
