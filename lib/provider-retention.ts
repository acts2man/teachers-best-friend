/**
 * Deleting the AI provider's copy of a background job.
 *
 * Background requests are sent with `store: false`, so the provider keeps a
 * response only long enough for us to collect the result and deletes it
 * automatically about 10 minutes after the job finishes (OpenAI API data
 * policy). We also delete it ourselves the moment we have read the result --
 * belt and braces, so nothing lingers even inside that window. This helper is
 * that delete: it retries a transient refusal, treats an already-gone id (404)
 * as done, and never throws. It reads and logs nothing about what the job
 * contained.
 *
 * A one-time admin backfill (app/api/admin/provider-backfill) uses it to delete
 * the copy of every past scan that still has a provider id, so the old
 * store:true backlog is cleared and `scans.provider_deleted_at` records it.
 */

const RESPONSES = "https://api.openai.com/v1/responses";

export type DeleteOutcome = "deleted" | "gone" | "failed";

type Options = {
  attempts?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  // A wall-clock deadline (ms, same scale as `clock`) this delete must finish
  // by. Each attempt's timeout is clamped to the time left, and no attempt or
  // backoff is started once the deadline is reached. Without it the old
  // behaviour holds: up to `attempts` tries at a fixed 15s timeout.
  deadline?: number;
  clock?: () => number;
};

const PER_ATTEMPT_MS = 15000;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const retryable = (status: number) => status === 429 || status >= 500;

/** Deletes the provider's stored copy of a response. Never throws. */
export async function deleteProviderCopy(id: string, key: string, opts: Options = {}): Promise<DeleteOutcome> {
  const { attempts = 3, fetchImpl = fetch, sleep = wait, deadline, clock = Date.now } = opts;
  const url = RESPONSES + "/" + encodeURIComponent(id);
  const headers = { Authorization: "Bearer " + key };
  const timeLeft = () => (deadline === undefined ? Infinity : deadline - clock());
  for (let attempt = 1; attempt <= attempts; attempt++) {
    // Out of time before this attempt even starts: one slow delete must not push
    // the whole backfill request past its budget.
    if (timeLeft() <= 0) {
      console.error("Deleting the provider copy ran out of time");
      return "failed";
    }
    const budget = Math.min(PER_ATTEMPT_MS, timeLeft());
    try {
      const r = await fetchImpl(url, { method: "DELETE", headers, signal: AbortSignal.timeout(budget) });
      if (r.ok) return "deleted";
      // 404 (deleted already) or 410 (expired): nothing left to delete.
      if (r.status === 404 || r.status === 410) return "gone";
      if (!retryable(r.status)) {
        console.error("Deleting the provider copy failed", r.status);
        return "failed";
      }
    } catch (error) {
      if (attempt === attempts) console.error("Deleting the provider copy failed", error instanceof Error ? error.name : "unknown");
    }
    if (attempt < attempts) {
      const backoff = 500 * 2 ** (attempt - 1);
      // No point sleeping into the deadline for a retry we could not run.
      if (timeLeft() <= backoff) return "failed";
      await sleep(backoff);
    }
  }
  return "failed";
}

/**
 * A scan is given up on after this many failed delete attempts, so one row the
 * provider will never let us delete (a revoked key, a response id that no longer
 * resolves) cannot wedge every pass behind it. Reported as `gaveUp`.
 */
export const MAX_DELETE_ATTEMPTS = 5;

/** A scan younger than this is treated as possibly in-flight and left alone. */
const IN_FLIGHT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * Time kept in reserve at the end of a pass's budget: enough for one in-flight
 * delete to finish, so the request returns on time rather than being cut off
 * mid-delete. New deletes stop starting once less than this remains.
 */
const DELETE_RESERVE_MS = 6000;

/**
 * The minimum of the Supabase client the backfill uses. Spelled as a finite
 * chain in the exact call order (not -> is -> lt -> neq -> lt -> order -> order
 * -> limit) rather than a self-referential interface: a recursive chain type
 * makes TS try to prove the real client's deeply-generic builder conforms and
 * trips "excessively deep" (TS2589).
 */
type Thenable = PromiseLike<{ data: unknown; error: unknown }>;
export type BackfillClient = {
  from: (t: string) => {
    select: (cols: string) => {
      not: (c: string, op: string, v: null) => {
        is: (c: string, v: null) => {
          lt: (c: string, v: number) => {
            neq: (c: string, v: string) => {
              lt: (c: string, v: string) => {
                order: (c: string) => {
                  order: (c: string) => { limit: (n: number) => Thenable };
                };
              };
            };
          };
        };
      };
    };
    update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => PromiseLike<{ error: unknown }> };
  };
};

export type BackfillCounts = {
  checked: number;
  deleted: number;
  alreadyGone: number;
  failed: number;
  gaveUp: number;
  more: boolean;
};

type PendingRow = { id: string; provider_response_id: string; provider_delete_attempts: number | null };

/**
 * One bounded pass of the admin backfill: deletes the provider copy of up to
 * `limit` past scans that still carry a provider id and are not yet recorded as
 * deleted, until the time budget runs out. Returns counts only; `more` is true
 * when a full batch came back, so the caller runs it again. Safe to call
 * repeatedly.
 *
 * It never touches an in-flight job -- only scans that are not 'analyzing' and
 * are older than an hour, so a background request the poll route is still
 * collecting is left for it. Rows are taken fewest-failed-attempts first (then
 * oldest), a failed delete bumps provider_delete_attempts, and a row that has
 * failed MAX_DELETE_ATTEMPTS times is skipped and reported as `gaveUp` rather
 * than re-selected forever. Each delete is given the pass deadline so one slow
 * delete cannot overrun the budget, and no new delete starts inside the final
 * DELETE_RESERVE_MS.
 */
export async function backfillProviderCopies(
  svc: BackfillClient,
  key: string,
  { now = new Date(), limit = 50, budgetMs = 22000, remove = deleteProviderCopy, clock = Date.now } = {},
): Promise<BackfillCounts> {
  const olderThan = new Date(now.getTime() - IN_FLIGHT_WINDOW_MS).toISOString();
  const { data, error } = await svc
    .from("scans")
    .select("id, provider_response_id, provider_delete_attempts")
    .not("provider_response_id", "is", null)
    .is("provider_deleted_at", null)
    .lt("provider_delete_attempts", MAX_DELETE_ATTEMPTS)
    .neq("status", "analyzing")
    .lt("created_at", olderThan)
    .order("provider_delete_attempts")
    .order("created_at")
    .limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as PendingRow[];
  const counts: BackfillCounts = { checked: 0, deleted: 0, alreadyGone: 0, failed: 0, gaveUp: 0, more: rows.length >= limit };
  const deadline = clock() + budgetMs;
  for (const row of rows) {
    // Stop starting new deletes with less than one delete's worth of budget
    // left; there is more to do, so the caller runs another pass.
    if (deadline - clock() < DELETE_RESERVE_MS) return { ...counts, more: true };
    counts.checked++;
    const outcome = await remove(row.provider_response_id, key, { deadline, clock });
    if (outcome === "failed") {
      const attempts = (row.provider_delete_attempts ?? 0) + 1;
      const { error: upErr } = await svc
        .from("scans")
        .update({ provider_delete_attempts: attempts, provider_delete_last_error_at: now.toISOString() })
        .eq("id", row.id);
      if (upErr) console.error("Recording a failed provider deletion failed (backfill)");
      if (attempts >= MAX_DELETE_ATTEMPTS) counts.gaveUp++;
      else counts.failed++;
      continue;
    }
    counts[outcome === "deleted" ? "deleted" : "alreadyGone"]++;
    const { error: upErr } = await svc.from("scans").update({ provider_deleted_at: now.toISOString() }).eq("id", row.id);
    if (upErr) console.error("Recording provider deletion failed (backfill)");
  }
  return counts;
}
