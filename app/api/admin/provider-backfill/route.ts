import { requireAdminApi } from "@/lib/admin-gate";
import { apiError, HttpError, aiConfig } from "@/lib/teacher-server";
import { hasSupabaseConfig } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { scansSweepDb, sweepProviderCopies } from "@/lib/provider-retention";

// Fits the 26s host limit; the admin calls it again while `more` is true.
export const maxDuration = 26;

/**
 * Admin backfill (review of #203): deletes the AI provider's stored copy for
 * past background jobs whose deletion is unrecorded, oldest first. It drains as
 * many as fit in one request's time budget and returns `more: true` when work
 * remains, so it is safe to call repeatedly until `more` is false -- a copy
 * already deleted, or one that has failed too many times, is skipped by the SQL
 * function, so a stuck job never blocks the rest. Admin only. Counts only.
 */
export async function POST() {
  try {
    await requireAdminApi();
    if (!hasSupabaseConfig()) throw new HttpError(404, "Not available here.");
    const svc = createServiceClient();
    const key = (await aiConfig()).key;
    const db = scansSweepDb(svc);
    const total = { checked: 0, deleted: 0, alreadyGone: 0, failed: 0, more: false, passes: 0 };
    const started = Date.now();
    // Drain batches until the budget runs out or nothing deletable is left.
    // olderThanMs 0 so every past job is in scope; the SQL function still only
    // returns ones safe to delete (terminal, or past the job lifetime).
    while (Date.now() - started < 22000) {
      const counts = await sweepProviderCopies(db, key, { olderThanMs: 0, limit: 50, budgetMs: 8000 });
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
      // A pass that only failed (no progress) means what is left is stuck; the
      // SQL guard skips those after a few tries, so stop rather than spin.
      if (counts.deleted + counts.alreadyGone === 0) break;
    }
    console.info("provider-backfill", JSON.stringify(total));
    return Response.json({ ok: true, ...total });
  } catch (e) {
    return apiError(e);
  }
}
