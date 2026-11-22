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
 * id). It marks a stale `analyzing` lesson scan `failed` and releases the one
 * credit that should come back:
 *   - a never-collected `full` version released its own `gen:<scanId>` charge
 *     (it never failed through the analyze route, so nothing else did it); and
 *   - a never-collected `flow` version of a run whose full WAS delivered means
 *     the run owes a refund the client's immediate ask could not get -- the
 *     flow was still 'analyzing', not 'failed', when the client asked (Ricky,
 *     16 Nov 2026). Now that this sweep fails the flow, it releases the run's
 *     full credit exactly as refund_only_on_failed_version intends, through the
 *     same refund_lesson_generation function -- once, server-checked.
 * "Stale" means older than an hour: well past the 13-minute client poll
 * deadline, and the longest real job on record was ~95s, so a job this old is
 * never still running.
 *
 * DRY RUN BY DEFAULT: with `apply` false (the default) it changes nothing and
 * reports the ids it would fail; only `apply: true` writes. Counts only and
 * safe to run repeatedly -- it fails a row only `where status='analyzing'`, so
 * a concurrent pass or the client cannot double-handle one, and a refund is
 * counted only when a page-charge row actually changed. Driven by an admin
 * endpoint, never a cron. It does NOT touch the provider's stored copy --
 * lib/provider-retention owns that and already clears an orphan's copy.
 */

type Thenable<T = unknown> = PromiseLike<{ data: T; error: unknown }>;

/** The slice of the Supabase service client this sweep uses. */
interface SelectChain {
  eq(c: string, v: string): SelectChain;
  is(c: string, v: null): SelectChain;
  lt(c: string, v: string): SelectChain;
  order(c: string): SelectChain;
  limit(n: number): Thenable<unknown[] | null>;
}
interface UpdateChain {
  eq(c: string, v: string): UpdateChain;
  is(c: string, v: null): UpdateChain;
  // `.select()` makes the write return the rows it actually changed, so a
  // guarded update that matched nothing (already released, already failed) is
  // not miscounted as a change.
  select(cols: string): Thenable<unknown[] | null>;
}
export type LessonSweepClient = {
  from: (t: string) => {
    select: (cols: string) => SelectChain;
    update: (v: Record<string, unknown>) => UpdateChain;
  };
  rpc: (fn: string, args: Record<string, unknown>) => Thenable<number | null>;
};

export type LessonOrphanCounts = {
  checked: number;
  failed: number;
  refunded: number;
  more: boolean;
  /** True when this pass changed nothing (the default). */
  dryRun: boolean;
  /** The scan ids this pass failed, or (in a dry run) would fail. */
  ids: string[];
};

/** A scan still 'analyzing' and younger than this might be a live job; leave it. */
const STALE_AFTER_MS = 60 * 60 * 1000; // 1 hour

type OrphanRow = {
  id: string;
  teacher_id: string | null;
  billable: boolean | null;
  params: { lessonPart?: string | null; lessonRun?: string | null } | null;
};

/** Only the charged version of a Generate is `full` (flows and questions are free). */
function isChargedFull(row: OrphanRow): boolean {
  const part = row.params?.lessonPart ?? "full";
  return part === "full" && row.billable !== false;
}

/**
 * One bounded pass. With `apply: true` it fails up to `limit` stale,
 * never-collected lesson scans and releases the credit each owes; by default
 * (`apply` false) it changes nothing and only reports what it would fail.
 * `more` is true when a full batch came back, so the caller runs it again.
 */
export async function sweepLessonOrphans(
  svc: LessonSweepClient,
  { now = new Date(), limit = 200, olderThanMs = STALE_AFTER_MS, apply = false } = {},
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
  const counts: LessonOrphanCounts = {
    checked: 0,
    failed: 0,
    refunded: 0,
    more: rows.length >= limit,
    dryRun: !apply,
    ids: [],
  };
  for (const row of rows) {
    counts.checked++;
    counts.ids.push(row.id);
    if (!apply) {
      // Dry run: write nothing. Report what would be failed, and -- only for a
      // charged full, whose gen:<id> charge is certain -- what would be
      // refunded. A flow's refund depends on a guarded write and the run's
      // state, so it is left to the apply pass rather than guessed here.
      counts.failed++;
      if (isChargedFull(row)) counts.refunded++;
      continue;
    }
    // Fail the row, but only while it is still 'analyzing' (in the update's own
    // WHERE), so a concurrent sweep or a late client poll cannot double-handle
    // it; count it only when the update truly changed a row.
    const { data: failedRows, error: upErr } = await svc
      .from("scans")
      .update({ status: "failed", error: "Never collected — the request lost its response; released." })
      .eq("id", row.id)
      .eq("status", "analyzing")
      .select("id");
    if (upErr) {
      console.error("Failing a lesson orphan failed");
      continue;
    }
    if (!failedRows || failedRows.length === 0) continue; // someone else got it first
    counts.failed++;
    if (isChargedFull(row) && row.teacher_id) {
      // A never-collected full never released its own credit; release the
      // gen:<id> charge now, guarded on released_at so a second pass is a
      // no-op, and count it only when a row actually changed.
      const { data: rel, error: relErr } = await svc
        .from("page_charges")
        .update({ released_at: nowIso })
        .eq("teacher_id", row.teacher_id)
        .eq("content_sha256", "gen:" + row.id)
        .is("released_at", null)
        .select("id");
      if (relErr) console.error("Releasing a lesson orphan's credit failed");
      else if (rel && rel.length) counts.refunded++;
    } else if (row.params?.lessonPart === "flow" && row.teacher_id && row.params?.lessonRun) {
      // A flow version of a run whose full was delivered and charged: now that
      // this flow is recorded 'failed', release the run's full credit through
      // the same server-checked function the client uses -- once (it guards on
      // released_at and returns the number of rows it released).
      const { data: hit, error: rpcErr } = await svc.rpc("refund_lesson_generation", {
        p_teacher: row.teacher_id,
        p_run: row.params.lessonRun,
      });
      if (rpcErr) console.error("Refunding a lesson run on a failed flow failed");
      else if ((hit ?? 0) > 0) counts.refunded++;
    }
  }
  return counts;
}
