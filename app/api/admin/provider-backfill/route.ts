import { requireAdminApi } from "@/lib/admin-gate";
import { apiError, HttpError, aiConfig } from "@/lib/teacher-server";
import { hasSupabaseConfig } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { backfillProviderCopies } from "@/lib/provider-retention";

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
    const svc = createServiceClient();
    const key = (await aiConfig()).key;
    const total = { checked: 0, deleted: 0, alreadyGone: 0, failed: 0, more: false, passes: 0 };
    const started = Date.now();
    while (Date.now() - started < 22000) {
      const counts = await backfillProviderCopies(svc, key, { limit: 50, budgetMs: 8000 });
      total.checked += counts.checked;
      total.deleted += counts.deleted;
      total.alreadyGone += counts.alreadyGone;
      total.failed += counts.failed;
      total.passes++;
      if (!counts.more) {
        total.more = false;
        break;
      }
      total.more = true;
      // A pass that made no progress (every row failed) means what is left is
      // stuck; stop rather than spin, and report it for a human.
      if (counts.deleted + counts.alreadyGone === 0) break;
    }
    console.info("provider-backfill", JSON.stringify(total));
    return Response.json({ ok: true, ...total });
  } catch (e) {
    return apiError(e);
  }
}
