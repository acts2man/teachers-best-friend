/**
 * Failing lesson scans that were never collected.
 *
 * A background lesson request (lib/analyze-server.ts, store:false) creates its
 * scan row and starts the job, then returns the scan id in the POST response.
 * The browser collects the result by polling /api/analyze/{scanId}. If the
 * browser loses that response -- a dropped connection, a slept phone: a client
 * `status 0` -- it never learns the id and never polls, so the row sits in
 * `status='analyzing'` forever (Ricky, 16 Nov 2026: flow scan 7108d98b…). For
 * the charged `full` version that also means its one credit stays spent.
 *
 * This is the server-side backstop the client cannot provide (it never got the
 * id). It marks a stale `analyzing` lesson scan `failed`, and -- only for the
 * charged `full` version -- releases its one credit (the `gen:<scanId>` page
 * charge), exactly as refund_lesson_generation would. "Stale" means older than
 * an hour: well past the 13-minute client poll deadline, and the longest real
 * job on record was ~95s, so a job this old is never still running.
 *
 * Counts only; safe to run repeatedly (a row it has already failed is no longer
 * 'analyzing', so a second pass skips it). Driven by an admin endpoint, never a
 * cron. It does NOT touch the provider's stored copy -- lib/provider-retention
 * owns that and already clears an 'analyzing' orphan's copy after an hour.
 */

type Thenable = PromiseLike<{ data: unknown; error: unknown }>;

/** The slice of the Supabase service client this sweep uses. */
interface SelectChain {
  eq(c: string, v: string): SelectChain;
  is(c: string, v: null): SelectChain;
  lt(c: string, v: string): SelectChain;
  order(c: string): SelectChain;
  limit(n: number): Thenable;
}
interface UpdateChain extends PromiseLike<{ error: unknown }> {
  eq(c: string, v: string): UpdateChain;
  is(c: string, v: null): UpdateChain;
}
export type LessonSweepClient = {
  from: (t: string) => {
    select: (cols: string) => SelectChain;
    update: (v: Record<string, unknown>) => UpdateChain;
  };
};

export type LessonOrphanCounts = { checked: number; failed: number; refunded: number; more: boolean };

/** A scan still 'analyzing' and younger than this might be a live job; leave it. */
const STALE_AFTER_MS = 60 * 60 * 1000; // 1 hour

type OrphanRow = {
  id: string;
  teacher_id: string | null;
  billable: boolean | null;
  params: { lessonPart?: string | null } | null;
};

/** Only the charged version of a Generate is `full` (flows and questions are free). */
function isChargedFull(row: OrphanRow): boolean {
  const part = row.params?.lessonPart ?? "full";
  return part === "full" && row.billable !== false;
}

/**
 * One bounded pass: fails up to `limit` stale, never-collected lesson scans and
 * releases the charged ones' credit. `more` is true when a full batch came
 * back, so the caller runs it again.
 */
export async function sweepLessonOrphans(
  svc: LessonSweepClient,
  { now = new Date(), limit = 200, olderThanMs = STALE_AFTER_MS } = {},
): Promise<LessonOrphanCounts> {
  const olderThan = new Date(now.getTime() - olderThanMs).toISOString();
  const nowIso = now.toISOString();
  const { data, error } = await svc
    .from("scans")
    .select("id, teacher_id, billable, params")
    .eq("stage", "lesson")
    .eq("status", "analyzing")
    .is("result", null)
    .lt("created_at", olderThan)
    .order("created_at")
    .limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as OrphanRow[];
  const counts: LessonOrphanCounts = { checked: 0, failed: 0, refunded: 0, more: rows.length >= limit };
  for (const row of rows) {
    counts.checked++;
    const { error: upErr } = await svc
      .from("scans")
      .update({ status: "failed", error: "Never collected — the request lost its response; released." })
      .eq("id", row.id);
    if (upErr) {
      console.error("Failing a lesson orphan failed");
      continue;
    }
    counts.failed++;
    // Release the one credit of the charged full version (the gen:<id> page
    // charge), scoped to its teacher. A free flow/question has no charge.
    if (isChargedFull(row) && row.teacher_id) {
      const { error: relErr } = await svc
        .from("page_charges")
        .update({ released_at: nowIso })
        .eq("teacher_id", row.teacher_id)
        .eq("content_sha256", "gen:" + row.id)
        .is("released_at", null);
      if (relErr) console.error("Releasing a lesson orphan's credit failed");
      else counts.refunded++;
    }
  }
  return counts;
}
