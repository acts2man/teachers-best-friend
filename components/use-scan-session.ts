"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  mergeSessions,
  parseSession,
  releaseGrading,
  scanPollMs,
  sessionFingerprint,
  type ScanSession,
} from "@/lib/scan-session";
/** How long after the last change a save waits, so a burst of edits is one save. */
const SAVE_DELAY_MS = 800;

/** This browser's id, so a device can tell its own grading lock from another's. */
export function deviceId(): string {
  try {
    const key = "tbf.device";
    const found = localStorage.getItem(key);
    if (found) return found;
    const made = crypto.randomUUID();
    localStorage.setItem(key, made);
    return made;
  } catch {
    return "device-" + Math.random().toString(36).slice(2);
  }
}

type Remote = { state: unknown; revision: number };

/**
 * Whether this device's copy of the scan has ever been on the account. If it
 * has, and the account now has nothing, the other device finished (or started
 * over) -- so this device clears its copy instead of putting a finished scan
 * back. If it never has, it is a scan started offline, and it goes up.
 */
const syncedKey = (assessmentId: string) => "tbf.scan-synced." + assessmentId;
function markSynced(assessmentId: string, on: boolean) {
  try {
    if (on) localStorage.setItem(syncedKey(assessmentId), "1");
    else localStorage.removeItem(syncedKey(assessmentId));
  } catch {
    // Storage refused: worst case an offline scan is offered again.
  }
}
function wasSynced(assessmentId: string) {
  try {
    return localStorage.getItem(syncedKey(assessmentId)) === "1";
  } catch {
    return false;
  }
}

/**
 * Keeps a class scan in step with the teacher's account, so a scan started on
 * the phone shows on the computer and the other way round (lib/scan-session.ts,
 * /api/scans/session).
 *
 * `session` is what this device has now. Every change is saved shortly after it
 * happens; the server's copy is checked when the panel opens, when the tab
 * comes back into view, and every 15 seconds while it is open. A newer copy
 * from the other device is handed to `apply`. If both devices changed the scan
 * since they last agreed, the two are merged (no page is ever dropped) and the
 * merge is saved.
 *
 * `paused` holds off applying the other device's changes while this device is
 * in the middle of something (uploading, grading, saving) -- this device is the
 * one writing then. Without account storage (a host with no Supabase) it does
 * nothing and the local draft carries on as before.
 */
export function useScanSession({
  assessmentId,
  device,
  session,
  apply,
  paused,
}: {
  assessmentId: string;
  /** This browser's id, so it can release only its own grading note. */
  device: string;
  session: ScanSession | null;
  apply: (next: ScanSession | null) => void;
  paused: boolean;
}) {
  const [available, setAvailable] = useState(true);
  // What this device was last told by, or last told, the server.
  const revision = useRef(0);
  const agreed = useRef<string | null>(null);
  const loaded = useRef(false);
  const latest = useRef(session);
  const applyRef = useRef(apply);
  const pausedRef = useRef(paused);
  useEffect(() => {
    latest.current = session;
    applyRef.current = apply;
    pausedRef.current = paused;
  });
  const saving = useRef(false);
  // Shown as a one-line note when the other device's work appears here.
  const [notice, setNotice] = useState("");

  const url = "/api/scans/session?assessmentId=" + encodeURIComponent(assessmentId);

  const put = useCallback(
    async (first: ScanSession): Promise<void> => {
      saving.current = true;
      let state = first;
      try {
        // Two tries: the second is the merge after a conflict.
        for (let attempt = 0; attempt < 2; attempt++) {
          const r = await fetch("/api/scans/session", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ assessmentId, state, baseRevision: revision.current }),
          });
          if (r.status === 503) return setAvailable(false);
          if (r.status === 409) {
            // The other device saved first. Keep both sides' work and try again.
            const remote = (await r.json()) as Remote;
            revision.current = remote.revision;
            const theirs = parseSession(remote.state);
            agreed.current = theirs ? sessionFingerprint(theirs) : null;
            state = theirs ? mergeSessions(theirs, state) : state;
            applyRef.current(state);
            continue;
          }
          if (!r.ok) return;
          const d = (await r.json()) as { revision: number };
          revision.current = d.revision;
          agreed.current = sessionFingerprint(state);
          markSynced(assessmentId, true);
          return;
        }
      } catch {
        // Offline or a blip: the local draft still has it, and the next change
        // or check tries again.
      } finally {
        saving.current = false;
      }
    },
    [assessmentId],
  );

  const pull = useCallback(async () => {
    if (saving.current) return;
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (r.status === 503) return setAvailable(false);
      if (!r.ok) return;
      const remote = (await r.json()) as Remote;
      const first = !loaded.current;
      loaded.current = true;
      const mine = latest.current;
      if (remote.revision === revision.current && !first) return;
      const theirs = parseSession(remote.state);
      if (!theirs) {
        revision.current = remote.revision;
        // Nothing on the account. If this device has a scan (an offline start,
        // or one from before this existed), put it there for the other device.
        if (first && mine) {
          if (wasSynced(assessmentId)) {
            markSynced(assessmentId, false);
            if (!pausedRef.current) applyRef.current(null);
          } else await put(mine);
        } else if (!first && remote.revision === 0 && agreed.current) {
          // The other device saved the class or started over.
          agreed.current = null;
          markSynced(assessmentId, false);
          if (!pausedRef.current) applyRef.current(null);
        }
        return;
      }
      if (pausedRef.current) return;
      revision.current = remote.revision;
      markSynced(assessmentId, true);
      const mineChanged =
        !!mine && sessionFingerprint(mine) !== (agreed.current ?? sessionFingerprint(theirs));
      if (mine && mineChanged && (first || agreed.current)) {
        // Both sides moved: keep everything from both, then save that.
        const merged = mergeSessions(theirs, mine);
        agreed.current = sessionFingerprint(theirs);
        applyRef.current(merged);
        await put(merged);
      } else {
        agreed.current = sessionFingerprint(theirs);
        applyRef.current(theirs);
      }
      setNotice(first && !mine ? "Picked up the scan from your other device." : "");
    } catch {
      // Offline: carry on with what this device has.
    }
  }, [url, put, assessmentId]);

  // First load, then whenever the tab comes back or the network returns, then
  // on a self-scheduling timer: a few seconds while a scan is being worked (so a
  // phone scan shows on the computer on its own), the slow idle poll otherwise.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = () => {
      if (document.visibilityState === "visible") void pull();
      if (!stopped) timer = setTimeout(tick, scanPollMs(latest.current));
    };
    const first = setTimeout(tick, 0);
    const onVisible = () => {
      if (document.visibilityState === "visible") void pull();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onVisible);
      clearTimeout(first);
      clearTimeout(timer);
    };
  }, [pull]);

  // Save shortly after anything changes here.
  const fingerprint = session ? sessionFingerprint(session) : "";
  useEffect(() => {
    if (!available || !loaded.current) return;
    if (!session) return;
    if (fingerprint === agreed.current) return;
    const t = setTimeout(() => void put(session), SAVE_DELAY_MS);
    return () => clearTimeout(t);
    // `session` is captured through the fingerprint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint, available, put]);

  /**
   * Hand the grading note back when this device leaves mid-grade, so the device
   * the teacher moves to can resume at once instead of waiting out the stale
   * window. Best effort with keepalive so it still goes out as the page tears
   * down; only this device's own note is ever cleared. The regular save on the
   * next pull reconciles the revision.
   */
  const releaseGradingNote = useCallback(() => {
    const s = latest.current;
    if (!s || !available) return;
    const next = releaseGrading(s, device);
    if (next === s) return; // nothing of ours to release
    try {
      void fetch("/api/scans/session", {
        method: "PUT",
        keepalive: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assessmentId, state: next, baseRevision: revision.current }),
      }).catch(() => {});
    } catch {
      // Leaving anyway; the stale window is the backstop.
    }
  }, [assessmentId, device, available]);

  /** The class was saved or the teacher started over: clear it everywhere. */
  const clear = useCallback(async () => {
    agreed.current = null;
    revision.current = 0;
    markSynced(assessmentId, false);
    if (!available) return;
    try {
      await fetch(url, { method: "DELETE" });
    } catch {
      // The row expires on its own after 7 days.
    }
  }, [url, available, assessmentId]);

  return { clear, releaseGrading: releaseGradingNote, notice, synced: available };
}
