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
 * scan in `status='analyzing'` forever, and the one credit it owes stays spent.
 * This fails every such stale ( > 1h old ) lesson scan and releases the credit
 * each owes -- a never-collected full's own gen:<id> charge, and a run's full
 * credit when one of its flow versions was the casualty (lib/lesson-orphan.ts).
 *
 * DRY RUN BY DEFAULT. A plain POST changes nothing and reports the scan ids it
 * WOULD fail (`dryRun: true`). To actually apply it, POST with `?apply=1` (or a
 * JSON body `{"apply":true}`). Run the dry run first and read the ids before
 * applying. Counts only; safe to call repeatedly until `more` is false. Admin
 * only. No cron. It does NOT touch the provider's stored copy -- provider
 * retention owns that.
 */
export async function POST(req: Request) {
  try {
    await requireAdminApi();
    if (!hasSupabaseConfig()) throw new HttpError(404, "Not available here.");
    const apply = await wantsApply(req);
    // A narrow slice of the service client; cast so matching the full client's
    // deeply-generic builder doesn't trip TS2589 at the call.
    const svc = createServiceClient() as unknown as LessonSweepClient;
    // Dry run reports wouldFail/wouldRefund (projected, nothing changed); apply
    // reports failed/refunded (actual changes). Review of #216, nit 10.
    let checked = 0, acted = 0, credited = 0, passes = 0, more = false;
    const ids: string[] = [];
    const started = Date.now();
    while (Date.now() - started < 22000) {
      const counts = await sweepLessonOrphans(svc, { limit: 200, apply });
      checked += counts.checked;
      acted += counts.dryRun ? counts.wouldFail : counts.failed;
      credited += counts.dryRun ? counts.wouldRefund : counts.refunded;
      ids.push(...counts.ids);
      passes++;
      more = counts.more;
      // A dry run writes nothing, so a second pass would re-read the same rows
      // forever: report this batch and let the admin apply it in batches.
      if (!apply) break;
      if (!counts.more) break;
      // A pass that failed nothing means the rest are stuck behind a transient
      // problem; stop rather than spin.
      if (acted === 0) break;
    }
    const body = apply
      ? { ok: true, dryRun: false, checked, failed: acted, refunded: credited, more, passes, ids }
      : { ok: true, dryRun: true, checked, wouldFail: acted, wouldRefund: credited, more, passes, ids };
    console.info("lesson-orphan-sweep", JSON.stringify({ ...body, ids: ids.length }));
    return Response.json(body);
  } catch (e) {
    return apiError(e);
  }
}

/** Apply only on an explicit opt-in: `?apply=1`/`true`, or a JSON `{apply:true}`. */
async function wantsApply(req: Request): Promise<boolean> {
  const truthy = (v: string | null) => v === "1" || v === "true";
  if (truthy(new URL(req.url).searchParams.get("apply"))) return true;
  try {
    const body = (await req.clone().json()) as { apply?: unknown };
    return body?.apply === true;
  } catch {
    return false;
  }
}
