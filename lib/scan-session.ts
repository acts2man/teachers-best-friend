import type { GradedGroup, ResolvedGroup } from "./teacher-class-scan";

/**
 * A class scan in progress, as it is saved to the teacher's account so the
 * phone and the computer see the same thing (class_scan_sessions, via
 * /api/scans/session).
 *
 * Michael scanned his class on his phone, opened his computer, and saw nothing
 * of it: the scan lived only in the phone's localStorage. Everything a teacher
 * would expect to carry over is here -- the pages in scan order and where each
 * student's pile ends, how far grading got, the name matches waiting to be
 * confirmed, and which device is grading right now. Pure, so the merge rules
 * can be tested without a network.
 */

/** One uploaded page: the whole page for grading and its name-area copy. */
export type ScanPage = {
  key: string;
  label: string;
  bodyId: string;
  stripId: string | null;
  /** Pages in the body upload, counted server-side. A photograph is 1. */
  pages: number;
  /** Size of the body upload, so a grading request stays under the route's
   * 12 MB limit. Absent on pages scanned before it was recorded. */
  bytes?: number;
};

/** How far grading got: batches done, the next to send, one still running. */
export type ScanProgress = {
  graded: GradedGroup[];
  nextBatch: number;
  scanId: string | null;
};

export type ScanSession = {
  v: 1;
  /** piles[i] is student i's pages in scan order; the last pile is open. */
  piles: ScanPage[][];
  progress: ScanProgress | null;
  /** Graded students waiting for the teacher to confirm whose paper is whose. */
  groups: ResolvedGroup[] | null;
  /** Keys of groups the teacher set aside on the matching screen. */
  discarded: string[];
  /** The graded pages' upload ids, in scan order (for the matching screen). */
  pageUploadIds: string[];
  /**
   * The device grading this scan right now, and when it last said so. Another
   * device shows "grading on your other device" instead of grading the same
   * stack a second time -- which would read the names twice and send the same
   * pages to the model twice.
   */
  grading: { device: string; at: number } | null;
};

/** A grading device that has not checked in for this long has stopped (the
 * phone slept, the tab closed). Another device may then pick the scan up. */
export const GRADING_STALE_MS = 2 * 60 * 1000;

export const EMPTY_SESSION: ScanSession = {
  v: 1,
  piles: [[]],
  progress: null,
  groups: null,
  discarded: [],
  pageUploadIds: [],
  grading: null,
};

function isPage(x: unknown): x is ScanPage {
  const p = x as ScanPage;
  return !!p && typeof p.bodyId === "string" && typeof p.key === "string";
}

/**
 * A session read back from the server, or null if there is nothing usable in
 * it. Trusts nothing: a row written by an older app, or half-written, must not
 * crash the panel a teacher is standing in front of.
 */
export function parseSession(raw: unknown): ScanSession | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<ScanSession>;
  const piles = Array.isArray(r.piles)
    ? r.piles
        .filter(Array.isArray)
        .map((pile) =>
          pile.filter(isPage).map((p) => ({
            key: p.key,
            label: typeof p.label === "string" ? p.label : "Page",
            bodyId: p.bodyId,
            stripId: typeof p.stripId === "string" ? p.stripId : null,
            pages: Number.isInteger(p.pages) && p.pages > 0 ? p.pages : 1,
            ...(typeof p.bytes === "number" && p.bytes > 0 ? { bytes: p.bytes } : {}),
          })),
        )
    : [];
  const progress =
    r.progress &&
    Array.isArray(r.progress.graded) &&
    Number.isInteger(r.progress.nextBatch) &&
    r.progress.nextBatch >= 0
      ? {
          graded: r.progress.graded,
          nextBatch: r.progress.nextBatch,
          scanId: typeof r.progress.scanId === "string" ? r.progress.scanId : null,
        }
      : null;
  const groups = Array.isArray(r.groups)
    ? r.groups.filter(
        (g): g is ResolvedGroup =>
          !!g &&
          typeof g.key === "string" &&
          Array.isArray(g.pageUploadIds) &&
          Array.isArray(g.candidateIds) &&
          Array.isArray(g.responses),
      )
    : null;
  const grading =
    r.grading && typeof r.grading.device === "string" && typeof r.grading.at === "number"
      ? { device: r.grading.device, at: r.grading.at }
      : null;
  const session: ScanSession = {
    v: 1,
    piles: piles.length ? piles : [[]],
    progress,
    groups: groups && groups.length ? groups : null,
    discarded: Array.isArray(r.discarded)
      ? r.discarded.filter((k): k is string => typeof k === "string")
      : [],
    pageUploadIds: Array.isArray(r.pageUploadIds)
      ? r.pageUploadIds.filter((k): k is string => typeof k === "string")
      : [],
    grading,
  };
  return isEmptySession(session) ? null : session;
}

/** Nothing scanned, nothing graded, nothing to match. */
export function isEmptySession(s: ScanSession): boolean {
  return !s.piles.some((p) => p.length) && !s.progress && !s.groups;
}

/** Where the teacher is: still scanning, grading, or matching names. */
export function sessionStep(s: ScanSession): "scanning" | "grading" | "matching" {
  if (s.groups) return "matching";
  if (s.progress || s.grading) return "grading";
  return "scanning";
}

/** Whether some OTHER device is grading this scan right now. */
export function gradingElsewhere(s: ScanSession | null, device: string, now: number): boolean {
  if (!s?.grading) return false;
  return s.grading.device !== device && now - s.grading.at < GRADING_STALE_MS;
}

/**
 * Both devices changed the scan since they last agreed: put them together
 * rather than letting either side's pages vanish.
 *
 * The server's version is the base. A page only this device has (photographed
 * while the other device was also adding pages, or while offline) is kept: if
 * its pile already shares pages with one of the server's piles it joins that
 * student, otherwise it keeps its own pile boundaries and goes after the
 * server's students. Nothing is dropped -- a lost reference is a page the
 * teacher paid to upload and can no longer reach.
 *
 * Grading progress goes to whichever side got further, and the name-matching
 * groups to whichever side has them (the server's if both do: it is the
 * version the other device has been editing).
 */
export function mergeSessions(server: ScanSession, local: ScanSession): ScanSession {
  const piles = server.piles.map((p) => [...p]);
  const onServer = new Set(piles.flat().map((p) => p.bodyId));
  for (const pile of local.piles) {
    const fresh = pile.filter((p) => !onServer.has(p.bodyId));
    if (!fresh.length) continue;
    const shared = piles.findIndex((sp) =>
      sp.some((p) => pile.some((lp) => lp.bodyId === p.bodyId)),
    );
    if (shared >= 0) piles[shared].push(...fresh);
    else {
      // Before the server's open pile when that pile is empty, so the open
      // pile stays last; otherwise after everything.
      const last = piles[piles.length - 1];
      if (last && !last.length) piles.splice(piles.length - 1, 0, fresh);
      else piles.push(fresh);
    }
    for (const p of fresh) onServer.add(p.bodyId);
  }
  const progress =
    !server.progress
      ? local.progress
      : !local.progress
        ? server.progress
        : local.progress.nextBatch > server.progress.nextBatch
          ? local.progress
          : server.progress;
  const groups = server.groups ?? local.groups;
  return {
    v: 1,
    piles: piles.length ? piles : [[]],
    progress: groups ? null : progress,
    groups,
    discarded: server.groups ? server.discarded : local.discarded,
    pageUploadIds: server.groups ? server.pageUploadIds : local.pageUploadIds,
    grading: server.grading ?? local.grading,
  };
}

/** Stable text for "has anything changed since we last agreed". */
export function sessionFingerprint(s: ScanSession): string {
  return JSON.stringify(s);
}
