import { owningTeacherId, guardOrigin, apiError, HttpError } from "@/lib/teacher-server";
import { hasSupabaseConfig } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { billingEnabled } from "@/lib/billing/config";
import { readBilling } from "@/lib/billing/server";

/**
 * Everything the billing page needs to draw itself.
 *
 * Unlike the other billing routes this one does NOT 503 when billing is off --
 * it answers with `billingEnabled: false` instead. The page has to render in
 * that state, showing the plans with "Opening soon" on the buttons, and a page
 * that cannot load its own data cannot show a teacher anything except an
 * error. "We are not selling yet" is information, not a failure.
 *
 * Prices and quotas come from public.plans, never from the client, and only
 * the ones we are actually advertising.
 */
export async function GET(request: Request) {
  try {
    guardOrigin(request);
    const teacher = await owningTeacherId();
    if (!hasSupabaseConfig())
      throw new HttpError(503, "Plans are not available on this host yet.");
    const svc = createServiceClient();

    const [{ data: plans, error }, state] = await Promise.all([
      svc
        .from("plans")
        .select("id, name, price_cents, scan_quota")
        .eq("active", true)
        .eq("listed", true)
        .gt("price_cents", 0)
        .order("sort_order"),
      readBilling(svc, teacher),
    ]);
    if (error) {
      console.error("Reading plans failed", error.message);
      throw new HttpError(500, "Couldn’t load the plans. Please try again.");
    }

    // The teacher's own plan is read separately so a plan they are on but that
    // is no longer listed -- beta, today -- still shows its real name and
    // quota rather than appearing as nothing.
    let currentName: string | null = null;
    let currentQuota: number | null = null;
    if (state) {
      const { data: mine } = await svc
        .from("plans")
        .select("name, scan_quota")
        .eq("id", state.planId)
        .maybeSingle();
      currentName = (mine?.name as string | undefined) ?? null;
      currentQuota = (mine?.scan_quota as number | undefined) ?? null;
    }

    return Response.json(
      {
        billingEnabled: billingEnabled(),
        plans: plans ?? [],
        current: state
          ? {
              planId: state.planId,
              planName: currentName,
              quota: currentQuota,
              status: state.status,
              periodEnd: state.periodEnd,
              hasCustomer: Boolean(state.customerId),
              hasSubscription: Boolean(state.subscriptionId),
            }
          : null,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
