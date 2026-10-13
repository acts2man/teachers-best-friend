import { readJson } from "@/lib/utils";
import { announceScanComplete } from "@/lib/quota-client";

// Background analyses are polled until they finish. A slow reasoning model on a
// large document can take a few minutes, so allow generous headroom before
// giving up; the teacher's uploads are saved regardless.
const POLL_DEADLINE_MS = 13 * 60 * 1000;

/**
 * The analyze endpoint answers with a different shape for every mode --
 * questions, responses, groups, pages, standards -- and each caller narrows it
 * to the one it asked for. Naming that here keeps the escape hatch in a single
 * documented place instead of a disable comment on every signature.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnalyzeResult = any;

/** A failed analysis, with what kind of failure it was, so a caller can tell
 * a passing fault (worth one more try) from a refusal (never). */
export class AnalyzeError extends Error {
  constructor(
    message: string,
    /** The HTTP status, or "job-failed" / "deadline" for a background job. */
    public reason: number | "job-failed" | "deadline",
  ) {
    super(message);
  }
}

/**
 * Whether trying again could help (#125 follow-up review): a network failure,
 * a background job that failed, or a server error other than 503. Never a
 * refusal -- a 4xx, including the teacher's daily cap (429); never 503, which
 * is also the platform's spending cap; never the 13-minute poll deadline, which
 * would only start a duplicate of a job that may still finish.
 */
export function isRetryableAnalyzeError(e: unknown): boolean {
  if (e instanceof AnalyzeError) {
    if (e.reason === "job-failed") return true;
    if (e.reason === "deadline") return false;
    return e.reason >= 500 && e.reason !== 503;
  }
  // fetch rejects with a TypeError when the network fails.
  return e instanceof TypeError;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs an analysis request against /api/analyze. When the server answers
 * synchronously the result comes straight back; when it starts a background
 * job the server returns a scan id and this polls /api/analyze/{id} until the
 * analysis completes. Resolves to the same `{ result }` shape either way, and
 * throws a teacher-facing Error on failure or timeout.
 */
/**
 * `onScanId` hands back the id of a background job as soon as the server
 * issues one, before the wait begins. A caller that records it can pick the
 * same job up later instead of starting a new one: the work is already running
 * on the provider's side, and the teacher has already been charged for it.
 */
export async function analyzeRequest(
  body: unknown,
  opts?: { onScanId?: (scanId: string) => void },
): Promise<AnalyzeResult> {
  const r = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await readJson(r);
  if (!r.ok) {
    // A refused scan still moves the meter's meaning (402 = out of scans), so
    // let the UI re-read it rather than showing a stale "you have N left".
    announceScanComplete();
    throw new AnalyzeError(d.error, r.status);
  }
  if (!d.scanId) {
    announceScanComplete();
    return d;
  }
  opts?.onScanId?.(d.scanId);
  const result = await pollScan(d.scanId);
  announceScanComplete();
  return result;
}

/**
 * Picks a background analysis back up.
 *
 * The phone that started a scan is what finishes it: polling is where the
 * result is validated and written. A teacher who taps "done" on a class set and
 * locks their phone -- which is the workflow they asked for, scan now and grade
 * later at a desk -- would otherwise come back to a job still running and
 * grades that never landed. Resuming costs nothing: the model call already
 * happened and was already billed.
 */
export async function resumeScan(scanId: string): Promise<AnalyzeResult> {
  const result = await pollScan(scanId);
  announceScanComplete();
  return result;
}

async function pollScan(scanId: string): Promise<AnalyzeResult> {
  const deadline = Date.now() + POLL_DEADLINE_MS;
  let delay = 1500;
  while (Date.now() < deadline) {
    await sleep(delay);
    const r = await fetch("/api/analyze/" + encodeURIComponent(scanId), {
      cache: "no-store",
    });
    const d = await readJson(r);
    if (!r.ok) throw new AnalyzeError(d.error, r.status);
    if (d.status === "complete") return { result: d.result };
    if (d.status === "failed")
      throw new AnalyzeError(
        d.error ||
          "The analysis couldn’t be completed. Your documents are saved.",
        "job-failed",
      );
    delay = Math.min(Math.round(delay * 1.3), 5000);
  }
  throw new AnalyzeError(
    "The analysis is taking longer than expected. Your uploads are saved — please check back shortly.",
    "deadline",
  );
}
