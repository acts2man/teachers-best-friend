import type Stripe from "stripe";
import { apiError, HttpError } from "@/lib/teacher-server";
import { hasSupabaseConfig } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { billingEnabled, BILLING_DISABLED_MESSAGE, stripeClient } from "@/lib/billing/stripe";
import { retrieveSubscription } from "@/lib/billing/server";
import {
  customerIdFrom,
  decide,
  isSubscriptionEvent,
  subscriptionIdFrom,
} from "@/lib/billing/webhook-logic";

type ServiceClient = ReturnType<typeof createServiceClient>;

// This one is called by Stripe, not by a browser. No session, no guardOrigin:
// the signature IS the authentication, and it is the only thing that is. An
// origin check here would reject Stripe and let nothing else through that the
// signature would not have caught anyway.
export const maxDuration = 26;

export async function POST(request: Request) {
  try {
    if (!billingEnabled() || !hasSupabaseConfig())
      throw new HttpError(503, BILLING_DISABLED_MESSAGE);

    // The RAW body. Stripe signs the exact bytes it sent, so anything that
    // parses and re-serialises first -- request.json() and back through
    // JSON.stringify -- changes key order or spacing and every signature
    // fails.
    const raw = await request.text();
    const signature = request.headers.get("stripe-signature");
    if (!signature) throw new HttpError(400, "Missing signature.");

    let event: Stripe.Event;
    try {
      event = stripeClient().webhooks.constructEvent(
        raw,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET as string,
      );
    } catch (e) {
      // Nothing is written. An unverified body is not evidence of anything,
      // and recording it would let anyone fill the ledger with event ids.
      console.error(
        "Stripe signature verification failed",
        e instanceof Error ? e.message : String(e),
      );
      throw new HttpError(400, "Invalid signature.");
    }

    const svc = createServiceClient();

    // Claim the event BEFORE doing any work. The primary key is what makes a
    // duplicate delivery impossible to act on twice; see the migration.
    const claim = await claimEvent(svc, event.id, event.type);
    if (claim === "already-processed")
      return Response.json({ received: true, duplicate: true });

    try {
      await handle(svc, event);
      await svc
        .from("billing_events")
        .update({ processed_at: new Date().toISOString(), error: null })
        .eq("event_id", event.id);
      return Response.json({ received: true });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.error("Webhook handling failed", event.type, event.id, reason);
      // Leave processed_at null so the next delivery retries the work, and
      // record why for whoever has to read this later. The 500 is what tells
      // Stripe to send it again.
      await svc
        .from("billing_events")
        .update({ error: reason.slice(0, 500) })
        .eq("event_id", event.id);
      return Response.json({ error: "Webhook handling failed." }, { status: 500 });
    }
  } catch (error) {
    return apiError(error);
  }
}

/**
 * Records that we have seen this event.
 *
 * Three outcomes, and the middle one is the one worth being careful about:
 *   - brand new                       -> "claimed", do the work
 *   - seen and processed              -> "already-processed", do nothing
 *   - seen but NOT processed          -> "claimed", do the work again
 *
 * That last case is why `processed_at` exists at all. If "seen" alone meant
 * skip, a single failed attempt would bury the event forever: stored, so never
 * retried, but never actually applied -- a teacher who paid and stayed on the
 * free plan, with a row in the table that looks like it was handled.
 */
async function claimEvent(
  svc: ServiceClient,
  eventId: string,
  type: string,
): Promise<"claimed" | "already-processed"> {
  const { error } = await svc
    .from("billing_events")
    .insert({ event_id: eventId, type });
  if (!error) return "claimed";
  // 23505 is the primary key: we have seen this id before.
  if (error.code !== "23505") {
    console.error("Recording billing event failed", error.message);
    throw new HttpError(500, "Couldn’t record this event.");
  }
  const { data } = await svc
    .from("billing_events")
    .select("processed_at")
    .eq("event_id", eventId)
    .maybeSingle();
  return data?.processed_at ? "already-processed" : "claimed";
}

async function handle(svc: ServiceClient, event: Stripe.Event) {
  if (!isSubscriptionEvent(event.type)) return;

  const subscriptionId = subscriptionIdFrom(event);
  // An event with no subscription behind it -- a one-off invoice, a checkout
  // that was not for a subscription -- is acknowledged and dropped.
  if (!subscriptionId) return;

  // Always the state Stripe holds now, never the snapshot in the event. Events
  // can arrive out of order, and an older `updated` landing after a newer one
  // would otherwise put the teacher back on the cheaper plan.
  const subscription = await retrieveSubscription(subscriptionId);
  if (!subscription)
    throw new Error(`could not retrieve subscription ${subscriptionId}`);

  const decision = decide(event, subscription, new Date());
  if (decision.action === "ignore") return;
  if (decision.action === "fail") throw new Error(decision.reason);

  const teacher =
    decision.teacherId ?? (await teacherByCustomer(svc, customerIdFrom(event)));
  if (!teacher)
    throw new Error(
      `no teacher for event ${event.id}: no metadata and no row for customer ${customerIdFrom(event) ?? "(none)"}`,
    );

  const { error } = await svc
    .from("subscriptions")
    .update({ ...decision.row, updated_at: new Date().toISOString() })
    .eq("teacher_id", teacher);
  if (error) throw new Error(`writing subscription failed: ${error.message}`);
}

/** Invoices carry no teacher id, so fall back to the customer we stored. */
async function teacherByCustomer(
  svc: ServiceClient,
  customerId: string | null,
): Promise<string | null> {
  if (!customerId) return null;
  const { data } = await svc
    .from("subscriptions")
    .select("teacher_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return (data?.teacher_id as string | undefined) ?? null;
}
