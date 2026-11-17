import { requireAdminApi } from "@/lib/admin-gate";
import { apiError, HttpError } from "@/lib/teacher-server";
import { hasSupabaseConfig } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sweepLessonOrphans, type LessonSweepClient } from "@/lib/lesson-orphan";

// Fits the 26s host limit; the admin calls it again while `more` is true.
export const maxDuration = 26;

/**
 * Admin backstop for lesson scans that were never collected: a background
 * lesson request whose POST response the browser lost (status 0) leaves its
 * scan in `status='analyzing'` forever, and for the charged `full` version its
 * one credit stays spent. This fails every such stale ( > 1h old ) lesson scan
 * and releases the charged ones' credit (lib/lesson-orphan.ts).
 *
 * Counts only; safe to call repeatedly until `more` is false. Admin only. No
 * cron. It does NOT touch the provider's stored copy -- provider-backfill owns
 * that.
 */
export async function POST() {
  try {
    await requireAdminApi();
    if (!hasSupabaseConfig()) throw new HttpError(404, "Not available here.");
    // A narrow slice of the service client; cast so matching the full client's
    // deeply-generic builder doesn't trip TS2589 at the call.
    const svc = createServiceClient() as unknown as LessonSweepClient;
    const total = { checked: 0, failed: 0, refunded: 0, more: false, passes: 0 };
    const started = Date.now();
    while (Date.now() - started < 22000) {
      const counts = await sweepLessonOrphans(svc, { limit: 200 });
      total.checked += counts.checked;
      total.failed += counts.failed;
      total.refunded += counts.refunded;
      total.passes++;
      if (!counts.more) {
        total.more = false;
        break;
      }
      total.more = true;
      // A pass that failed nothing means the rest are stuck behind a transient
      // problem; stop rather than spin.
      if (counts.failed === 0) break;
    }
    console.info("lesson-orphan-sweep", JSON.stringify(total));
    return Response.json({ ok: true, ...total });
  } catch (e) {
    return apiError(e);
  }
}
