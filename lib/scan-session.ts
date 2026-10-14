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
  /** The run's own pages and how it grouped them into students, so a resume
   * grades the same students (gap G3: a whole-stack run grouped by name, and
   * its resume used to treat the stack as one student). Absent on progress
   * saved before this was recorded. */
  pageIds?: string[];
  pageGroups?: number[][];
  /** Whether the run grouped by the names read (no piles declared). */
  byName?: boolean;
  /** Each batch's whole-scan group numbers, as the run planned them. A
   * running job is only picked up under the same plan (gap G1). */
  batchPlan?: number[][];
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

/** A saved progress's grouping record, if it is well formed; {} otherwise. */
function runGrouping(p: Partial<ScanProgress>): Pick<ScanProgress, "pageIds" | "pageGroups" | "byName" | "batchPlan"> {
  const ids = p.pageIds;
  const groups = p.pageGroups;
  if (!Array.isArray(ids) || !ids.every((x) => typeof x === "string")) return {};
  if (!Array.isArray(groups)) return {};
  const inRange = (x: unknown) => Number.isInteger(x) && (x as number) >= 0 && (x as number) < ids.length;
  if (!groups.every((g) => Array.isArray(g) && g.every(inRange))) return {};
  const plan = p.batchPlan;
  const planOk = Array.isArray(plan) && plan.every((b) => Array.isArray(b) && b.every((g) => Number.isInteger(g) && g >= 0 && g < groups.length));
  return { pageIds: ids, pageGroups: groups, byName: p.byName === true, ...(planOk ? { batchPlan: plan } : {}) };
}

/**
 * A saved grading progress, or null if it is not usable. One reader for the
 * server copy and the browser's local draft: the draft used to rebuild progress
 * by hand and drop the run's grouping, so a reload resumed a whole-stack scan
 * as one student (gap G3, review of the G3 PR).
 */
export function parseProgress(raw: unknown): ScanProgress | null {
  const p = raw as Partial<ScanProgress> | null | undefined;
  if (!p || !Array.isArray(p.graded) || !Number.isInteger(p.nextBatch) || (p.nextBatch as number) < 0) return null;
  return {
    graded: p.graded,
    nextBatch: p.nextBatch as number,
    scanId: typeof p.scanId === "string" ? p.scanId : null,
    // The run's grouping, kept only when it is well formed: a resume that
    // trusted a broken one could put answers on the wrong student.
    ...runGrouping(p),
  };
}

/**
 * How long an abandoned scan is worth offering back.
 *
 * The pages a draft points at are deleted on the retention schedule whether or
 * not anyone came back for them, so a draft outlives its own uploads. Offering
 * a teacher a month-old half-scan whose photographs no longer exist wastes
 * their time and fails confusingly. Comfortably longer than anyone's grading
 * session and comfortably shorter than the retention window.
 */
export const DRAFT_LIFETIME = 7 * 24 * 60 * 60 * 1000;

/** The class-scan panel's local draft (localStorage): the piles, and the
 * grading progress if it got that far. Shared shape with the account copy. */
export type ScanDraft = { piles: ScanPage[][]; progress: ScanProgress | null };

/**
 * The local draft read back, or null if there is nothing usable in it. Trusts
 * nothing: a half-written or hand-edited draft is dropped, not allowed to crash
 * the panel a teacher is standing in front of.
 */
export function parseDraft(raw: string | null, now: number = Date.now()): ScanDraft | null {
  try {
    if (!raw) return null;
    const stored = JSON.parse(raw);
    // Drafts written before grading jobs were remembered are a bare array.
    const parsed = Array.isArray(stored) ? stored : stored?.piles;
    const progress = Array.isArray(stored) ? null : (stored?.progress ?? null);
    const savedAt = Array.isArray(stored) ? null : stored?.savedAt;
    if (!Array.isArray(parsed)) return null;
    // Older than the pages it refers to, so there is nothing useful left in it.
    if (typeof savedAt === "number" && now - savedAt > DRAFT_LIFETIME) return null;
    const piles = parsed
      .filter(Array.isArray)
      .map((pile: unknown[]) =>
        pile
          .filter(isPage)
          // Drafts saved before pages were counted carry no count. A
          // photograph is one page, which is what all of them were.
          .map((page) => ({ ...page, pages: page.pages ?? 1 })),
      );
    if (!piles.some((pile: ScanPage[]) => pile.length)) return null;
    return { piles, progress: parseProgress(progress) };
  } catch {
    return null;
  }
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
