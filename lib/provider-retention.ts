/**
 * Deleting the AI provider's copy of a background job (review of #203).
 *
 * A background job has to be stored at the provider (store: true) so it can
 * be read back by its id. The provider keeps it until we delete it. Before
 * this, the copy was deleted only on a successful poll; a job that failed, hit
 * an error after its result was read, or was never polled again stayed there,
 * and the delete itself was tried once and its outcome ignored.
 *
 * Now:
 *   - deleteProviderCopy tries up to 3 times (a 429, a 5xx or a dropped
 *     connection is tried again), treats "already gone" (404) as deleted, and
 *     says how it went;
 *   - the poll route deletes it whenever the job has finished, whatever
 *     happens next (a finally block), and records the time it did;
 *   - a scheduled sweep (app/api/cron/provider-sweep) deletes whatever is
 *     still there an hour after the scan started -- a job never polled again,
 *     or a delete that failed every try -- and an admin backfill does the same
 *     for every past scan.
 * Nothing here reads or logs what the job contained.
 */

const RESPONSES = "https://api.openai.com/v1/responses";

export type DeleteOutcome = "deleted" | "gone" | "failed";

type Options = {
  /** Cancel first: for a job that may still be running (sweep, orphan). */
  cancelFirst?: boolean;
  attempts?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const retryable = (status: number) => status === 429 || status >= 500;

/** Deletes the provider's stored copy of a response. Never throws. */
export async function deleteProviderCopy(id: string, key: string, opts: Options = {}): Promise<DeleteOutcome> {
  const { cancelFirst = false, attempts = 3, fetchImpl = fetch, sleep = wait } = opts;
  const url = RESPONSES + "/" + encodeURIComponent(id);
  const headers = { Authorization: "Bearer " + key };
  if (cancelFirst) {
    // A finished job refuses to cancel (400); that is fine, it is deleted next.
    try {
      await fetchImpl(url + "/cancel", { method: "POST", headers, signal: AbortSignal.timeout(15000) });
    } catch {}
  }
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const r = await fetchImpl(url, { method: "DELETE", headers, signal: AbortSignal.timeout(15000) });
      if (r.ok) return "deleted";
      if (r.status === 404) return "gone";
      if (!retryable(r.status)) {
        console.error("Deleting the provider copy failed", r.status);
        return "failed";
      }
    } catch (error) {
      if (attempt === attempts) console.error("Deleting the provider copy failed", error instanceof Error ? error.name : "unknown");
    }
    if (attempt < attempts) await sleep(500 * 2 ** (attempt - 1));
  }
  return "failed";
}

/** The minimum a sweep needs from the database client. */
export type SweepDb = {
  /** Scans older than `before` with a provider copy not yet recorded as deleted, oldest first. */
  pending: (before: string, limit: number) => Promise<{ id: string; provider_response_id: string }[]>;
  /** Records the copy as deleted. */
  markDeleted: (scanId: string, at: string) => Promise<void>;
};

export const SWEEP_AGE_MS = 60 * 60 * 1000;

/**
 * One pass of the sweep: deletes the provider copy of every scan older than
 * `olderThanMs` that has one not yet recorded as deleted (at most `limit`).
 * Returns counts only -- never what a job contained.
 */
export async function sweepProviderCopies(
  db: SweepDb,
  key: string,
  { now = new Date(), olderThanMs = SWEEP_AGE_MS, limit = 100, remove = deleteProviderCopy } = {},
): Promise<{ checked: number; deleted: number; alreadyGone: number; failed: number }> {
  const before = new Date(now.getTime() - olderThanMs).toISOString();
  const counts = { checked: 0, deleted: 0, alreadyGone: 0, failed: 0 };
  for (const s of await db.pending(before, limit)) {
    counts.checked++;
    const outcome = await remove(s.provider_response_id, key, { cancelFirst: true });
    if (outcome === "failed") {
      counts.failed++;
      continue;
    }
    counts[outcome === "deleted" ? "deleted" : "alreadyGone"]++;
    await db.markDeleted(s.id, now.toISOString());
  }
  return counts;
}

/** The minimum of the Supabase client the sweep uses. */
export type SweepClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
  from: (t: string) => { update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => PromiseLike<{ error: unknown }> } };
};

/** A SweepDb backed by the scans table (the sweep and the admin backfill). */
export function scansSweepDb(svc: SweepClient): SweepDb {
  return {
    async pending(before, limit) {
      const { data, error } = await svc.rpc("scans_awaiting_provider_delete", { cutoff: before, max_rows: limit });
      if (error) throw error;
      return (data ?? []) as { id: string; provider_response_id: string }[];
    },
    async markDeleted(scanId, at) {
      const { error } = await svc.from("scans").update({ provider_deleted_at: at }).eq("id", scanId);
      if (error) console.error("Recording provider deletion failed (sweep)");
    },
  };
}
