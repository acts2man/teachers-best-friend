import {
  writingTeacherId,
  guardOrigin,
  apiError,
  HttpError,
  siteUrl,
} from "@/lib/teacher-server";
import { hasSupabaseConfig } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireBilling, stripeClient } from "@/lib/billing/stripe";
import { readBilling } from "@/lib/billing/server";

/**
 * Open Stripe's own billing portal.
 *
 * Everything a teacher might want to do to a subscription they already have --
 * change tier, update a card, cancel, read old invoices -- happens there
 * rather than in screens of ours. That is deliberate: the portal is already
 * correct about proration, tax and invoice history, and rebuilding any of it
 * would be rebuilding something that can quietly be wrong about money.
 */
export async function POST(request: Request) {
  try {
    guardOrigin(request);
    const teacher = await writingTeacherId();
    requireBilling();
    if (!hasSupabaseConfig())
      throw new HttpError(503, "Plans are not available on this host yet.");

    const state = await readBilling(createServiceClient(), teacher);
    if (!state?.customerId)
      throw new HttpError(
        404,
        "There’s no billing account to manage yet. Choose a plan to get started.",
      );

    const session = await stripeClient().billingPortal.sessions.create({
      customer: state.customerId,
      return_url: siteUrl(request, "/billing").toString(),
    });
    return Response.json({ url: session.url });
  } catch (error) {
    return apiError(error);
  }
}
