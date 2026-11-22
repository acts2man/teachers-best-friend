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
 *     gen:<full scan id> charge, of ANY age, only when that full is complete
 *     and billable. The refund function's own 2-hour window could not help
 *     here: the sweep runs by hand and only on scans already over an hour old,
 *     so by the time a flow is failed the run's full is usually past two hours
 *     (review of #216). Done in TypeScript, guarded on released_at, counted
 *     only when a page-charge row changed.
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

export type LessonOrphanCounts = {
  checked: number;
  more: boolean;
  /** The scan ids this pass failed, or (in a dry run) would fail. */
  ids: string[];
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
  params: { lessonPart?: string | null; lessonRun?: string | null } | null;
};

/** Only the charged version of a Generate is `full` (flows and questions are free). */
function isChargedFull(row: OrphanRow): boolean {
  const part = row.params?.lessonPart ?? "full";
  return part === "full" && row.billable !== false;
}

/** The teacher + page-charge key whose credit this orphan owes back, or null
 * when it owes none (a free flow of a run whose full was never delivered). */
async function releaseTargetFor(
  svc: LessonSweepClient,
  row: OrphanRow,
): Promise<{ teacher: string; key: string } | null> {
  if (!row.teacher_id) return null;
  // A charged full that was never collected: release its own gen:<id> charge.
  if (isChargedFull(row)) return { teacher: row.teacher_id, key: "gen:" + row.id };
  // A flow of a run: the run owes a refund only if its full was delivered
  // (complete) and billable. Find that full's scan id -- of any age.
  if (row.params?.lessonPart === "flow" && row.params?.lessonRun) {
    const { data, error } = await svc
      .from("scans")
      .select("id, status, billable")
      .eq("teacher_id", row.teacher_id)
      .eq("stage", "lesson")
      .eq("params->>lessonRun", row.params.lessonRun)
      .eq("params->>lessonPart", "full")
      .order("created_at")
      .limit(1);
    if (error) {
      console.error("Looking up a lesson run's full version failed");
      return null;
    }
    const full = ((data ?? []) as { id: string; status?: string; billable?: boolean | null }[])[0];
    if (full && full.status === "complete" && full.billable !== false) {
      return { teacher: row.teacher_id, key: "gen:" + full.id };
    }
  }
  return null;
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
    .select("id, teacher_id, billable, params")
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
  // Dry-run projection dedupes refunds by charge key, the way the apply pass's
  // guarded update does naturally: two flow orphans of one run owe one credit.
  const projected = new Set<string>();
  for (const row of rows) {
    checked++;
    ids.push(row.id);
    const target = await releaseTargetFor(svc, row);
    if (!apply) {
      failed++; // every candidate is 'analyzing', so it would be failed
      if (target && !projected.has(target.key) && (await chargeUnreleased(svc, target.teacher, target.key))) {
        projected.add(target.key);
        refunded++;
      }
      continue;
    }
    // Release FIRST (crash-safe), guarded on released_at; count only a real change.
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
    ? { checked, more, ids, dryRun: false, failed, refunded }
    : { checked, more, ids, dryRun: true, wouldFail: failed, wouldRefund: refunded };
}
