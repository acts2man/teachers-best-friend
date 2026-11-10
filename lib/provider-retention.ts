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

type Options = { attempts?: number; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> };

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const retryable = (status: number) => status === 429 || status >= 500;

/** Deletes the provider's stored copy of a response. Never throws. */
export async function deleteProviderCopy(id: string, key: string, opts: Options = {}): Promise<DeleteOutcome> {
  const { attempts = 3, fetchImpl = fetch, sleep = wait } = opts;
  const url = RESPONSES + "/" + encodeURIComponent(id);
  const headers = { Authorization: "Bearer " + key };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const r = await fetchImpl(url, { method: "DELETE", headers, signal: AbortSignal.timeout(15000) });
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
    if (attempt < attempts) await sleep(500 * 2 ** (attempt - 1));
  }
  return "failed";
}

/** The minimum of the Supabase client the backfill uses. */
export type BackfillClient = {
  from: (t: string) => {
    select: (cols: string) => {
      not: (c: string, op: string, v: null) => {
        is: (c: string, v: null) => { order: (c: string) => { limit: (n: number) => PromiseLike<{ data: unknown; error: unknown }> } };
      };
    };
    update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => PromiseLike<{ error: unknown }> };
  };
};

export type BackfillCounts = { checked: number; deleted: number; alreadyGone: number; failed: number; more: boolean };

/**
 * One bounded pass of the admin backfill: deletes the provider copy of up to
 * `limit` past scans that still carry a provider id and are not yet recorded as
 * deleted, oldest first, until the time budget runs out. Returns counts only;
 * `more` is true when a full batch came back, so the caller runs it again. Safe
 * to call repeatedly -- a scan already stamped is skipped, and a delete that
 * fails leaves the stamp null for the next pass.
 */
export async function backfillProviderCopies(
  svc: BackfillClient,
  key: string,
  { now = new Date(), limit = 50, budgetMs = 22000, remove = deleteProviderCopy, clock = Date.now } = {},
): Promise<BackfillCounts> {
  const { data, error } = await svc
    .from("scans")
    .select("id, provider_response_id")
    .not("provider_response_id", "is", null)
    .is("provider_deleted_at", null)
    .order("created_at")
    .limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as { id: string; provider_response_id: string }[];
  const counts: BackfillCounts = { checked: 0, deleted: 0, alreadyGone: 0, failed: 0, more: rows.length >= limit };
  const started = clock();
  for (const row of rows) {
    if (clock() - started > budgetMs) return { ...counts, more: true };
    counts.checked++;
    const outcome = await remove(row.provider_response_id, key);
    if (outcome === "failed") {
      counts.failed++;
      continue;
    }
    counts[outcome === "deleted" ? "deleted" : "alreadyGone"]++;
    const { error: upErr } = await svc.from("scans").update({ provider_deleted_at: now.toISOString() }).eq("id", row.id);
    if (upErr) console.error("Recording provider deletion failed (backfill)");
  }
  return counts;
}
