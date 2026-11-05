import { announceScanComplete } from "@/lib/quota-client";
/**
 * Asks for a Generate's credit back after one of its requests failed. True
 * only when the server released it; false when it would not or could not --
 * the screen then says so, and never claims a refund that did not happen.
 */
export async function refundLesson(lessonRun: string): Promise<boolean> {
  try {
    const r = await fetch("/api/lessons/refund", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lessonRun }),
    });
    if (!r.ok) return false;
    const d = (await r.json()) as { refunded?: boolean };
    // The meter moves back when the credit does.
    if (d.refunded === true) announceScanComplete();
    return d.refunded === true;
  } catch {
    return false;
  }
}
