"use client";
import { useSyncExternalStore } from "react";

/**
 * Whether the browser currently believes it has a connection.
 *
 * Classroom wifi is bad wifi. A teacher photographing thirty-six papers in a
 * room at the back of a building will drop off the network partway through,
 * and until now every one of those failures surfaced as a generic "upload
 * failed" with no hint that the problem was the building rather than the app or
 * the photograph. They would reasonably retake the picture, which cannot help.
 *
 * `navigator.onLine` is not a promise that requests will succeed -- it is false
 * only when the browser is certain there is no network. That makes it useless
 * as a guarantee and genuinely useful as an explanation: when it says offline,
 * it is right, and that is the one moment worth telling a teacher about.
 */
function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function useOnline() {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine !== false,
    // Assume online on the server: the alternative is every page rendering an
    // offline warning for the instant before hydration.
    () => true,
  );
}

/**
 * Turns a failed request into something a teacher can act on.
 *
 * A dropped connection and a rejected file both arrive here as an Error. The
 * difference matters: one means "wait and try again", the other means "this
 * file is the problem". Guessing wrong sends a teacher down the wrong path, so
 * only an actual loss of network is described as one.
 */
export function describeFailure(error: unknown, fallback: string) {
  // `=== false` rather than `!`: a runtime where navigator exists but does not
  // report onLine would otherwise be treated as permanently offline, and every
  // failure would be blamed on a connection that was fine.
  if (typeof navigator !== "undefined" && navigator.onLine === false)
    return "You're offline. Your pages are saved — try again once you're back on wifi.";
  const message = error instanceof Error ? error.message : "";
  // What fetch() throws when the request never reached a server.
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(message))
    return "The connection dropped. Your pages are saved — try again in a moment.";
  return message || fallback;
}

/**
 * Deletes uploaded pages, and says how it went.
 *
 * Every caller used to fire these and swallow the outcome
 * (`.catch(() => {})`), which meant a photograph of a child's work could fail
 * to delete and nobody -- teacher or us -- would ever know. The nightly purge
 * still catches it within the retention window, so nothing lingers forever, but
 * "deleted when you confirm the grading" is a published commitment and a silent
 * failure quietly turns that into "deleted within 30 days".
 *
 * Resolves to what did not go, so a caller can tell the teacher the truth:
 *   - `failed`: the delete itself failed (the nightly purge still collects it);
 *   - `keptInScan`: kept because a class scan in progress still uses it.
 * A file the saved workspace still uses (another test or resource holds the
 * identical file) was rightly kept and is not counted: it is that other
 * item's page now, not this one's.
 *
 * One request per call, not per photo: the server checks what is in use once
 * for the whole list (#187 review). A file kept only by a scan left behind by
 * a deleted test is not left to linger: that scan is cleared and the file
 * asked for once more. Deliberately never throws: a failed cleanup must not
 * undo the save that preceded it.
 */
export type DeleteOutcome = { failed: number; keptInScan: number };

type Kept = { id: string; by: "workspace" } | { id: string; by: "scan"; assessmentIds: string[]; leftover: boolean };
type DeleteReply = { deleted: string[]; missing: string[]; failed: string[]; kept: Kept[] };

/** The server's answer for `ids`; null when the request itself failed. */
async function deleteBatch(ids: string[]): Promise<DeleteReply | null> {
  try {
    const r = await fetch("/api/uploads/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    if (!r.ok) return null;
    return (await r.json()) as DeleteReply;
  } catch {
    return null;
  }
}

/** The server takes at most this many ids per request. */
const DELETE_BATCH = 500;

export async function deleteUploads(ids: string[]): Promise<DeleteOutcome> {
  const unique = [...new Set(ids)];
  if (!unique.length) return { failed: 0, keptInScan: 0 };
  let failed = 0;
  const inScan: Extract<Kept, { by: "scan" }>[] = [];
  for (let i = 0; i < unique.length; i += DELETE_BATCH) {
    const chunk = unique.slice(i, i + DELETE_BATCH);
    const reply = await deleteBatch(chunk);
    if (!reply) {
      failed += chunk.length;
      continue;
    }
    failed += reply.failed.length;
    for (const k of reply.kept) if (k.by === "scan") inScan.push(k);
  }
  // Kept only by a scan whose test is gone: clear that scan, ask once more.
  const leftover = inScan.filter((k) => k.leftover);
  let keptInScan = inScan.length - leftover.length;
  if (leftover.length) {
    const sessions = [...new Set(leftover.flatMap((k) => k.assessmentIds))];
    await Promise.all(
      sessions.map((id) =>
        fetch("/api/scans/session?assessmentId=" + encodeURIComponent(id), { method: "DELETE" }).catch(() => null),
      ),
    );
    const retry = await deleteBatch(leftover.map((k) => k.id));
    if (!retry) failed += leftover.length;
    else {
      failed += retry.failed.length;
      keptInScan += retry.kept.filter((k) => k.by === "scan").length;
    }
  }
  return { failed, keptInScan };
}

/** What to tell the teacher about pages a scan in progress kept. */
export function keptInScanMessage(n: number): string {
  return (
    (n === 1 ? "1 scanned page was" : n + " scanned pages were") +
    " kept because a class scan that isn't finished still uses " +
    (n === 1 ? "it" : "them") +
    ". Finish or start over that scan; " +
    (n === 1 ? "it" : "they") +
    "'ll be removed automatically."
  );
}
