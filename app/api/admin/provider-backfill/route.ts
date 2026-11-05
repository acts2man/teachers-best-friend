import { requireAdminApi } from "@/lib/admin-gate";
import { apiError, HttpError, aiConfig } from "@/lib/teacher-server";
import { hasSupabaseConfig } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { scansSweepDb, sweepProviderCopies } from "@/lib/provider-retention";

export const maxDuration = 300;

/**
 * One-time admin backfill (review of #203): deletes the AI provider's stored
 * copy for EVERY past background job not already recorded as deleted, however
 * old. The hourly sweep handles only the recent ones; this clears the backlog
 * of jobs that predate provider_deleted_at. Admin only. It reports counts and
 * logs counts -- never anything a job contained.
 */
export async function POST() {
  try {
    await requireAdminApi();
    if (!hasSupabaseConfig()) throw new HttpError(404, "Not available here.");
    const svc = createServiceClient();
    const key = (await aiConfig()).key;
    const total = { checked: 0, deleted: 0, alreadyGone: 0, failed: 0, passes: 0 };
    // Everything up to now: olderThanMs 0. Loop until a pass finds nothing left
    // to delete, or a pass makes no progress (every remaining id failed).
    for (let pass = 0; pass < 200; pass++) {
      const counts = await sweepProviderCopies(scansSweepDb(svc), key, { olderThanMs: 0, limit: 100 });
      total.checked += counts.checked;
      total.deleted += counts.deleted;
      total.alreadyGone += counts.alreadyGone;
      total.failed = counts.failed;
      total.passes = pass + 1;
      if (counts.deleted + counts.alreadyGone === 0) break;
    }
    console.info("provider-backfill", JSON.stringify(total));
    return Response.json({ ok: true, ...total });
  } catch (e) {
    return apiError(e);
  }
}
