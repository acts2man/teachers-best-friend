import { requireAdminApi } from "@/lib/admin-gate";
import { apiError, HttpError, aiConfig } from "@/lib/teacher-server";
import { hasSupabaseConfig } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { backfillProviderCopies, type BackfillClient } from "@/lib/provider-retention";

// Fits the 26s host limit; the admin calls it again while `more` is true.
export const maxDuration = 26;

/**
 * One-time admin backfill: deletes the AI provider's stored copy for every past
 * background scan that still carries a provider_response_id and is not yet
 * recorded as deleted, oldest first, and stamps scans.provider_deleted_at. This
 * clears the backlog from before background requests were sent with store:false.
 *
 * Bounded to the host's time limit: it drains as many as fit in one request and
 * returns `more: true` when work remains, so it is safe to call repeatedly until
 * `more` is false. Admin only. Counts only -- nothing a job contained is read or
 * logged.
 */
export async function POST() {
  try {
    await requireAdminApi();
    if (!hasSupabaseConfig()) throw new HttpError(404, "Not available here.");
    // The query builder the backfill needs is a narrow slice of the service
    // client; cast to that slice so matching the full client's deeply-generic
    // builder doesn't trip TS2589 at the call.
    const svc = createServiceClient() as unknown as BackfillClient;
    const key = (await aiConfig()).key;
    const total = { checked: 0, deleted: 0, alreadyGone: 0, failed: 0, gaveUp: 0, more: false, passes: 0 };
    const started = Date.now();
    const REQUEST_BUDGET_MS = 22000;
    while (Date.now() - started < REQUEST_BUDGET_MS) {
      // Hand each pass the time actually left in the request as its budget, so a
      // delete's own deadline can never run past the host's 26s function limit.
      const remaining = REQUEST_BUDGET_MS - (Date.now() - started);
      const counts = await backfillProviderCopies(svc, key, { limit: 50, budgetMs: remaining });
      total.checked += counts.checked;
      total.deleted += counts.deleted;
      total.alreadyGone += counts.alreadyGone;
      total.failed += counts.failed;
      total.gaveUp += counts.gaveUp;
      total.passes++;
      if (!counts.more) {
        total.more = false;
        break;
      }
      total.more = true;
      // A pass that neither deleted, found gone, nor gave up on anything (every
      // row failed transiently) means what is left is stuck behind a transient
      // problem; stop rather than spin, and report it for a human.
      if (counts.deleted + counts.alreadyGone + counts.gaveUp === 0) break;
    }
    console.info("provider-backfill", JSON.stringify(total));
    return Response.json({ ok: true, ...total });
  } catch (e) {
    return apiError(e);
  }
}
