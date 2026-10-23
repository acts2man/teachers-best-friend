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
  /** Uploaded as part of a whole stack at once (the desktop "upload a stack"
   * path), so the pile it sits in is NOT a student the teacher declared: the
   * names on the pages split it. Absent on camera and per-pile pages. */
  stack?: true;
};

/**
 * A page that still failed to upload after uploadFile's retries. It waits on
 * the scan screen with a Retry button while the rest of the batch carries on,
 * and remembers where it belongs: the student's pile, and how many of that
 * pile's pages came before it.
 */
export type FailedPage = {
  key: string;
  file: File;
  label: string;
  pile: number;
  index: number;
  stack?: true;
  reason: string;
};

/**
 * Puts a page that uploaded on a retry back where it was: into its student's
 * pile, at its place among that pile's pages. If that pile is gone (the scan
 * was reorganised meanwhile) it joins the last pile. A page from a whole stack
 * is marked as one.
 */
export function placeRetriedPage(
  piles: ScanPage[][],
  failed: Pick<FailedPage, "pile" | "index" | "stack">,
  page: ScanPage,
): ScanPage[][] {
  const next = piles.length ? piles.map((pile) => [...pile]) : [[]];
  const target = failed.pile < next.length ? failed.pile : next.length - 1;
  const placed = failed.stack ? { ...page, stack: true as const } : page;
  next[target].splice(Math.min(Math.max(0, failed.index), next[target].length), 0, placed);
  return next;
}

/** How far grading got: batches done, the next to send, one still running. */
export type ScanProgress = {
  graded: GradedGroup[];
  nextBatch: number;
  scanId: string | null;
  /**
   * What `graded[].group` and `nextBatch` are numbered against: the body
   * upload ids of every student group the run graded, in group order.
   * Without it a resume re-planned the groups from the piles as they are NOW
   * and laid the saved answers on them by index -- a whole-stack upload that
   * failed came back as ONE student holding every page, wearing the first
   * student's answers and another child's name (G3, docs/system-map.md); a
   * page added before resuming shifted every later student (G1). Absent on
   * progress saved before it existed, which therefore cannot be resumed.
   */
  layout?: string[][];
  /** The whole-scan groups of the batch `scanId` was sent for. A resume
   * waits on that job only if the next batch it plans holds exactly these
   * groups; otherwise the job's answers are numbered against some other set
   * of students, and it is sent again (free: pages are charged once). */
  inFlight?: number[];
};

/** Whether a saved in-flight job may be waited on for this batch. */
export function inFlightMatches(progress: ScanProgress | null | undefined, groupIndexes: number[]): boolean {
  const saved = progress?.inFlight;
  return (
    !!progress?.scanId &&
    Array.isArray(saved) &&
    saved.length === groupIndexes.length &&
    saved.every((g, i) => g === groupIndexes[i])
  );
}

/** The layout a run's progress is numbered against: each group's body ids. */
export function groupLayout(pageGroups: number[][], ids: string[]): string[][] {
  return pageGroups.map((g) => g.map((p) => ids[p]));
}

/**
 * Whether saved grading progress can be picked up for the pages on screen.
 *
 *   - `fresh`: nothing saved; grade from the start.
 *   - `resume`: the pages are exactly the ones the progress was graded
 *     against, in the same order. `pageGroups` is the saved grouping -- NOT
 *     one re-derived from the current piles -- so every banked answer lands on
 *     the group it was read from.
 *   - `changed`: the pages differ (added, removed, reordered, merged in from
 *     another device), the progress predates layouts, or it names a group the
 *     layout does not have. The banked answers cannot be put back on the
 *     right children, so nothing is guessed: the teacher is asked to grade
 *     again (pages already paid for cost nothing a second time).
 */
export type ResumePlan =
  | { kind: "fresh" }
  | { kind: "resume"; pageGroups: number[][] }
  | { kind: "changed" };

export function planResume(progress: ScanProgress | null | undefined, ids: string[]): ResumePlan {
  if (!progress) return { kind: "fresh" };
  const layout = progress.layout;
  if (!Array.isArray(layout) || !layout.length) return { kind: "changed" };
  if (layout.some((g) => !Array.isArray(g) || !g.length)) return { kind: "changed" };
  const flat = layout.flat();
  // The same pages in the same order, each once. Anything else is a stack
  // whose group numbers no longer mean what they meant.
  if (flat.length !== ids.length || flat.some((id, i) => id !== ids[i])) return { kind: "changed" };
  if (new Set(ids).size !== ids.length) return { kind: "changed" };
  if (progress.graded.some((g) => !Number.isInteger(g.group) || g.group < 0 || g.group >= layout.length))
    return { kind: "changed" };
  let page = 0;
  return { kind: "resume", pageGroups: layout.map((g) => g.map(() => page++)) };
}

/** Saved progress as it came back from storage, or null when unusable. */
export function parseProgress(raw: unknown): ScanProgress | null {
  const p = raw as Partial<ScanProgress> | null | undefined;
  if (!p || !Array.isArray(p.graded) || !Number.isInteger(p.nextBatch) || (p.nextBatch as number) < 0) return null;
  const layout =
    Array.isArray(p.layout) && p.layout.every((g) => Array.isArray(g) && g.every((id) => typeof id === "string"))
      ? (p.layout as string[][])
      : undefined;
  const inFlight =
    Array.isArray(p.inFlight) && p.inFlight.every((g) => Number.isInteger(g)) ? (p.inFlight as number[]) : undefined;
  return {
    graded: p.graded,
    nextBatch: p.nextBatch as number,
    scanId: typeof p.scanId === "string" ? p.scanId : null,
    ...(layout ? { layout } : {}),
    ...(inFlight ? { inFlight } : {}),
  };
}

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

/** How often a grading device refreshes its "I am grading this" note. The
 * component heartbeat; kept here so the stale window below is derived from it. */
export const GRADING_HEARTBEAT_MS = 30 * 1000;

/** A grading device that has not checked in for this long has stopped (the
 * phone slept, the tab closed, the teacher moved to the computer). Another
 * device may then pick the scan up. Two missed heartbeats plus a margin: long
 * enough that a device still grading is never judged stopped, short enough that
 * a teacher who moves to another device is not left watching a halted grade for
 * two minutes (Ricky: "leaving the screen stops grading"). A device that leaves
 * cleanly also releases its note (releaseGrading), so this is the backstop for
 * an unclean exit like a slept phone, not the normal path. */
export const GRADING_STALE_MS = 70 * 1000;

/**
 * Clear this device's grading note so another device can pick the scan up at
 * once. Used when the grading device navigates away: without it the other
 * device must wait out GRADING_STALE_MS before resuming. Leaves another
 * device's note untouched, and returns the session unchanged when there is
 * nothing to release. Pure.
 */
export function releaseGrading(s: ScanSession, device: string): ScanSession {
  if (!s.grading || s.grading.device !== device) return s;
  return { ...s, grading: null };
}

/** How soon the open panel should check the other device again. While a scan is
 * being worked (either device scanning or grading) a few seconds keeps the two
 * in step so a phone scan shows on the computer on its own; when nothing is in
 * flight the slow idle poll is enough and costs fewer requests. */
export function scanPollMs(s: ScanSession | null, fast = 4000, idle = 15000): number {
  if (!s) return idle;
  const step = sessionStep(s);
  return step === "scanning" || step === "grading" ? fast : idle;
}

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
            ...(p.stack === true ? { stack: true as const } : {}),
          })),
        )
    : [];
  const progress = parseProgress(r.progress);
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
  // "Further" is more students graded. nextBatch counts batches of a plan
  // that differs between runs (planRemainingBatches), so it says nothing
  // across two devices. Either way planResume still checks the pages.
  const progress =
    !server.progress
      ? local.progress
      : !local.progress
        ? server.progress
        : local.progress.graded.length > server.progress.graded.length ||
            (local.progress.graded.length === server.progress.graded.length &&
              local.progress.nextBatch > server.progress.nextBatch)
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

/**
 * The scanned pages no SAVED row covers, in their piles.
 *
 * A row is saved only when it has answers and a name (saveAll /
 * applyScannedGroups skip the rest). Pages without such a row are a run that
 * stopped part-way ("confirm those, then press Done for the rest"), pages the
 * other device added while this one was grading, or rows that came back with
 * no answers or had their name cleared (G1). Saving the class used to clear
 * every pile, so those pages -- uploaded, never saved -- vanished with no
 * message. They are kept for the next grading instead. Pages of a row the
 * teacher DISCARDED are covered: they set them aside on purpose.
 */
export function pagesWithoutRow(
  piles: ScanPage[][],
  groups: Pick<ResolvedGroup, "key" | "pageUploadIds" | "responses" | "name">[] | null,
  discarded: Set<string> = new Set(),
): ScanPage[][] {
  if (!groups) return [];
  const covered = new Set(
    groups
      .filter((g) => discarded.has(g.key) || (g.responses.length > 0 && g.name.trim() !== ""))
      .flatMap((g) => g.pageUploadIds),
  );
  return piles.map((pile) => pile.filter((p) => !covered.has(p.bodyId))).filter((pile) => pile.length);
}
