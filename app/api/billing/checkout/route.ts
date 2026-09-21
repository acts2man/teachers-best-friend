import { z } from "zod";
import {
  writingTeacherId,
  guardOrigin,
  apiError,
  HttpError,
  siteUrl,
} from "@/lib/teacher-server";
import { hasSupabaseConfig } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { PAID_PLANS, priceForPlan } from "@/lib/billing/config";
import { requireBilling, stripeClient } from "@/lib/billing/stripe";
import { alreadySubscribed, customerFor, readBilling } from "@/lib/billing/server";

/**
 * Start a Stripe Checkout session.
 *
 * The browser sends a plan name and nothing else. It does not send a price, an
 * amount, or a Stripe id, and none of those would be honoured if it did: the
 * price is looked up server-side from the environment. A request body that
 * could name its own price is a request body that can name $0.00.
 */
const checkoutInput = z.object({ plan: z.enum(PAID_PLANS) });

export async function POST(request: Request) {
  try {
    guardOrigin(request);
    // writingTeacherId refuses while an app manager is viewing as a teacher.
    // That is the behaviour we want: buying a plan on someone else's account
    // is not a thing "view as" should be able to do.
    const teacher = await writingTeacherId();
    requireBilling();
    if (!hasSupabaseConfig())
      throw new HttpError(503, "Plans are not available on this host yet.");

    const input = checkoutInput.safeParse(await request.json());
    if (!input.success) throw new HttpError(400, "Choose a plan to continue.");
    const { plan } = input.data;
    const price = priceForPlan(plan);
    if (!price) {
      // billingEnabled() already checked all five vars, so this is a
      // configuration that changed underneath us rather than a missing one.
      console.error("No price id configured for plan", plan);
      throw new HttpError(503, "That plan isn’t available yet. Please try again later.");
    }

    const svc = createServiceClient();
    const state = await readBilling(svc, teacher);

    // Refuse rather than create a second subscription. See alreadySubscribed:
    // Stripe would take the money for both.
    if (alreadySubscribed(state))
      throw new HttpError(
        409,
        "You already have a plan. Use Manage billing to change or cancel it.",
      );

    let email: string | null = null;
    try {
      const { data } = await svc.auth.admin.getUserById(teacher);
      email = data.user?.email ?? null;
    } catch {
      // Stripe will collect an email in checkout if we cannot supply one.
    }

    const customer = await customerFor(svc, teacher, email, state);

    const session = await stripeClient().checkout.sessions.create({
      mode: "subscription",
      customer,
      line_items: [{ price, quantity: 1 }],
      // Both of these are how the webhook knows whose subscription this is
      // without having to guess from the customer id.
      client_reference_id: teacher,
      metadata: { teacher_id: teacher, plan },
      subscription_data: { metadata: { teacher_id: teacher, plan } },
      // Straight back into the app's billing page either way, so a teacher
      // who cancels lands somewhere that makes sense rather than on the
      // marketing site wondering whether they were charged.
      success_url: siteUrl(request, "/billing?checkout=done").toString(),
      cancel_url: siteUrl(request, "/billing?checkout=cancelled").toString(),
      allow_promotion_codes: true,
    });
    if (!session.url)
      throw new HttpError(502, "Couldn’t open checkout. Please try again.");
    return Response.json({ url: session.url });
  } catch (error) {
    return apiError(error);
  }
}
