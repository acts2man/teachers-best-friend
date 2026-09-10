import { readJson } from "@/lib/utils";

// Background analyses are polled until they finish. A slow reasoning model on a
// large document can take a few minutes, so allow generous headroom before
// giving up; the teacher's uploads are saved regardless.
const POLL_DEADLINE_MS = 13 * 60 * 1000;

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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function analyzeRequest(body: unknown): Promise<any> {
  const r = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await readJson(r);
  if (!r.ok) throw new Error(d.error);
  if (!d.scanId) return d;
  return pollScan(d.scanId);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function pollScan(scanId: string): Promise<any> {
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
