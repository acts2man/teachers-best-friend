"use client";

/**
 * The teacher-facing view of the scan meter.
 *
 * /api/quota has existed since metering was added but nothing ever called it,
 * so a teacher's only signal that they were out of scans was a 402 thrown
 * mid-analysis, after they had already uploaded the work. The landing page
 * promises the opposite: "We'll tell you before you hit the limit, not after."
 */
export type Quota = {
  planId: string | null;
  quota: number;
  used: number;
  remaining: number;
  canScan: boolean;
};

/** Fired after any analysis finishes, so the meter refreshes without a poll. */
export const SCAN_COMPLETE_EVENT = "tbf:scan-complete";

export function announceScanComplete() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(SCAN_COMPLETE_EVENT));
}

/**
 * Reads the meter. Returns null rather than throwing: the meter is an
 * affordance, and a teacher who cannot load it should still be able to work.
 * It is also absent by design on the ChatGPT Sites host, which has no plans.
 */
export async function fetchQuota(): Promise<Quota | null> {
  try {
    const r = await fetch("/api/quota", { cache: "no-store" });
    if (!r.ok) return null;
    const d = await r.json();
    if (typeof d?.quota !== "number") return null;
    return {
      planId: d.plan_id ?? null,
      quota: Number(d.quota) || 0,
      used: Number(d.used) || 0,
      remaining: Number(d.remaining) || 0,
      canScan: Boolean(d.can_scan),
    };
  } catch {
    return null;
  }
}

/** How close to the limit the teacher is, for tone and for whether to warn. */
export function quotaLevel(q: Quota): "ok" | "low" | "out" {
  if (!q.canScan || q.remaining <= 0) return "out";
  if (q.quota > 0 && q.remaining / q.quota <= 0.15) return "low";
  return "ok";
}

/**
 * Did this failure mean "out of scans"?
 *
 * The page ledger answers a stack that does not fit with a 402 carrying a
 * teacher-readable sentence ("This class set is 30 pages. You have 12 scans
 * left."). That sentence is good on its own, but it leaves the teacher with
 * nowhere to go, so the callers that surface it attach a way to see the plans.
 *
 * Matched on the wording the server actually sends rather than on a status
 * code, because by the time this runs the response has been flattened into an
 * Error message.
 */
export function isOutOfScans(message: string): boolean {
  return /scans? left|no scans left|used all your scans/i.test(message);
}

/** Where a teacher goes to do something about it. */
export const SEE_PLANS = { label: "See plans", href: "/billing" } as const;
