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
 *     16 Nov 2026). This releases that run's full credit DIRECTLY by its
 *     gen:<full scan id> charge, found from the flow's `params->>lessonRun`,
 *     only when that full is complete and billable. The full may be any age
 *     (the refund function's own 2-hour window could not help a hand-run sweep
 *     that only touches scans over an hour old); its scan ROW must still carry
 *     params, though.
 *
 * NEEDS REVIEW -- the hard edge (review of #216): `purge_scan_payloads` wipes
 * `scans.params` nightly for rows older than 48h, including 'analyzing' ones.
 * A flow orphan whose params (or whose run's full's params) are gone can no
 * longer be linked to the full it would refund, and a flow is billable=false,
 * so failing it would strand the refund silently. So the sweep NEVER fails a
 * flow it cannot link: it leaves it 'analyzing' and reports it in `needsReview`
 * (id, teacherId, createdAt), in both the dry run and apply, for a human. It
 * fails + refunds a flow only when the link is certain (its params are present
 * and the run's full is found). We never guess the link from a timestamp. A
 * full is self-keyed by its own scan id, so a purge never blocks it.
 * "Stale" means older than an hour: well past the 13-minute client poll
 * deadline, and the longest real job on record was ~95s, so a job this old is
 * never still running.
 *
 * CRASH-SAFE ORDER: the credit is released BEFORE the scan is marked failed, so
 * a crash between the two leaves the scan still 'analyzing' -- a later sweep
 * picks it up again and the guarded release is a harmless no-op -- rather than a
 * 'failed' row (which the sweep would never revisit) with its credit stuck.
 *
 * DRY RUN BY DEFAULT: with `apply` false (the default) it changes nothing and
 * reports the ids it would fail and a projected `wouldFail`/`wouldRefund` from
 * read-only checks of the real charge state; only `apply: true` writes
 * (`failed`/`refunded`). Safe to run repeatedly -- it fails a row only `where
 * status='analyzing'`, and counts a refund only when a page-charge row actually
 * changed, so a repeat sweep gives nothing back twice. Admin endpoint, no cron.
 * It does NOT touch the provider's stored copy -- lib/provider-retention owns
 * that and already clears an orphan's copy.
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
};

export type NeedsReview = { id: string; teacherId: string | null; createdAt: string | null };

export type LessonOrphanCounts = {
  checked: number;
  more: boolean;
  /** The scan ids this pass failed, or (in a dry run) would fail. */
  ids: string[];
  /** Flow orphans that could not be linked to their full (params purged): left
   * untouched for a human, in both the dry run and apply. */
  needsReview: NeedsReview[];
} & (
  | { dryRun: true; wouldFail: number; wouldRefund: number }
  | { dryRun: false; failed: number; refunded: number }
);

/** A scan still 'analyzing' and younger than this might be a live job; leave it. */
const STALE_AFTER_MS = 60 * 60 * 1000; // 1 hour

type OrphanRow = {
  id: string;
  teacher_id: string | null;
  billable: boolean | null;
  created_at: string | null;
  params: { lessonPart?: string | null; lessonRun?: string | null } | null;
};

type Target = { teacher: string; key: string };
type Verdict =
  | { action: "fail"; target: Target | null } // fail the scan (and release target, if any)
  | { action: "review" }; // cannot link -- leave it, report it

/**
 * Decide what to do with one orphan.
 *   - A full (billable != false -- the only charged version) is self-keyed by
 *     its own scan id, so a params purge never blocks it: fail + release its
 *     own gen:<id> charge.
 *   - A free version (billable === false: a flow or a question). We fail +
 *     refund ONLY when we can see it is a flow and find its run's full: then we
 *     release the full's credit if it was delivered. A question (identified by
 *     params) owes nothing, so we fail it with no refund. When params are gone
 *     we cannot tell a refundable flow from a free question, nor find the full,
 *     so we must NOT fail it -- it needs review.
 */
async function classify(svc: LessonSweepClient, row: OrphanRow): Promise<Verdict> {
  if (row.billable !== false) {
    return { action: "fail", target: row.teacher_id ? { teacher: row.teacher_id, key: "gen:" + row.id } : null };
  }
  const part = row.params?.lessonPart ?? null;
  const run = row.params?.lessonRun ?? null;
  if (part === "flow" && run && row.teacher_id) {
    const { data, error } = await svc
      .from("scans")
      .select("id, status, billable")
      .eq("teacher_id", row.teacher_id)
      .eq("stage", "lesson")
      .eq("params->>lessonRun", run)
      .eq("params->>lessonPart", "full")
      .order("created_at")
      .limit(1);
    if (error) {
      console.error("Looking up a lesson run's full version failed");
      return { action: "review" }; // can't be certain -- hold it
    }
    const full = ((data ?? []) as { id: string; status?: string; billable?: boolean | null }[])[0];
    if (!full) return { action: "review" }; // the full's params were purged too
    if (full.status === "complete" && full.billable !== false) {
      return { action: "fail", target: { teacher: row.teacher_id, key: "gen:" + full.id } };
    }
    return { action: "fail", target: null }; // linked, but its full was never delivered -> owes nothing
  }
  if (part === "question") return { action: "fail", target: null }; // free, identifiable, owes nothing
  return { action: "review" }; // params purged: can't tell a flow from a question -> hold
}

/** Is this teacher's charge still unreleased? A read-only check for the dry run. */
async function chargeUnreleased(svc: LessonSweepClient, teacher: string, key: string): Promise<boolean> {
  const { data, error } = await svc
    .from("page_charges")
    .select("id")
    .eq("teacher_id", teacher)
    .eq("content_sha256", key)
    .is("released_at", null)
    .limit(1);
  if (error) {
    console.error("Checking a lesson charge failed");
    return false;
  }
  return (data ?? []).length > 0;
}

/**
 * One bounded pass. With `apply: true` it fails up to `limit` stale,
 * never-collected lesson scans and releases the credit each owes; by default
 * (`apply` false) it changes nothing and only projects what it would do.
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
    .select("id, teacher_id, billable, created_at, params")
    .eq("stage", "lesson")
    .eq("status", "analyzing")
    .is("result", null)
    .lt("created_at", olderThan)
    .order("created_at")
    .limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as OrphanRow[];
  let checked = 0;
  let failed = 0;
  let refunded = 0;
  const ids: string[] = [];
  const needsReview: NeedsReview[] = [];
  // Dry-run projection dedupes refunds by charge key, the way the apply pass's
  // guarded update does naturally: two flow orphans of one run owe one credit.
  const projected = new Set<string>();
  for (const row of rows) {
    checked++;
    const verdict = await classify(svc, row);
    if (verdict.action === "review") {
      // A flow we cannot link to its full: never fail it (that would strand its
      // refund) -- hand it to a human instead.
      needsReview.push({ id: row.id, teacherId: row.teacher_id, createdAt: row.created_at });
      continue;
    }
    const target = verdict.target;
    ids.push(row.id);
    if (!apply) {
      failed++; // every candidate here is 'analyzing', so it would be failed
      if (target && !projected.has(target.key) && (await chargeUnreleased(svc, target.teacher, target.key))) {
        projected.add(target.key);
        refunded++;
      }
      continue;
    }
    // Release FIRST (crash-safe), guarded on released_at; count only a real
    // change. The reverse order would risk a 'failed' row with a stuck credit
    // if the process died between the two writes -- only ever for a scan already
    // over an hour old, so practically impossible, but cheap to order safely.
    if (target) {
      const { data: rel, error: relErr } = await svc
        .from("page_charges")
        .update({ released_at: nowIso })
        .eq("teacher_id", target.teacher)
        .eq("content_sha256", target.key)
        .is("released_at", null)
        .select("id");
      if (relErr) console.error("Releasing a lesson orphan's credit failed");
      else if (rel && rel.length) refunded++;
    }
    // Then fail the row, only while still 'analyzing'; count only a real change.
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
    if (failedRows && failedRows.length) failed++;
  }
  const more = rows.length >= limit;
  return apply
    ? { checked, more, ids, needsReview, dryRun: false, failed, refunded }
    : { checked, more, ids, needsReview, dryRun: true, wouldFail: failed, wouldRefund: refunded };
}
