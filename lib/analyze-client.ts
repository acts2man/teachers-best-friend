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
    throw new Error(d.error);
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
    if (!r.ok) throw new Error(d.error);
    if (d.status === "complete") return { result: d.result };
    if (d.status === "failed")
      throw new Error(
        d.error ||
          "The analysis couldn’t be completed. Your documents are saved.",
      );
    delay = Math.min(Math.round(delay * 1.3), 5000);
  }
  throw new Error(
    "The analysis is taking longer than expected. Your uploads are saved — please check back shortly.",
  );
}
