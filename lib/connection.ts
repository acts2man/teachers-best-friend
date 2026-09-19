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
 * Resolves to the number that did not go, so a caller can tell the teacher the
 * truth. Deliberately never throws: a failed cleanup must not undo the save
 * that preceded it.
 */
export async function deleteUploads(ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const results = await Promise.all(
    ids.map(async (id) => {
      try {
        const r = await fetch("/api/uploads/" + encodeURIComponent(id), {
          method: "DELETE",
        });
        // A page already gone is a page that is gone.
        return r.ok || r.status === 404;
      } catch {
        return false;
      }
    }),
  );
  return results.filter((ok) => !ok).length;
}
