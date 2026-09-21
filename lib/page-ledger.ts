import "server-only";
import { HttpError } from "@/lib/http-error";
import type { createServiceClient } from "@/lib/supabase/service";
import type { Mode } from "@/lib/analyze-shared";

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * One scan = one page the teacher photographs or uploads.
 *
 * This module is the only place the application decides what a request costs.
 * It does not decide whether a page has been paid for already -- charge_pages
 * does, against a unique constraint on the page's bytes -- which is why a
 * replayed poll, a resumed class set and a second press of Grade all cost
 * nothing without any of those paths knowing about each other.
 */

/**
 * Modes that never cost a teacher anything.
 *
 * `name_strip` is our own privacy pass over pages the teacher is already
 * paying for: the page is cut in the browser and the name band sent separately
 * so that no single request holds a student's name beside their answers. That
 * is a choice we made about how to protect them, and charging for it would
 * bill them for our own safeguard.
 *
 * `catalog` unlocks standards into a library shared by every teacher.
 */
const FREE_MODES = new Set<Mode>(["name_strip", "catalog"]);

export function chargesForMode(mode: Mode): boolean {
  return !FREE_MODES.has(mode);
}

export type Charge = {
  charged: number;
  alreadyPaid: number;
  used: number;
  quota: number;
  remaining: number;
};

/**
 * A charging request with no uploaded page -- a lesson plan or reading passage
 * written from typed text -- still spends a model call, so it costs 1. The key
 * is unique per scan, so two generations are two scans while a retry of the
 * same one is free.
 */
export function generationKey(scanId: string): string {
  return "gen:" + scanId;
}

function quotaError(message: string): HttpError {
  // "needed N remaining M" comes back from charge_pages so the number a
  // teacher is told is the number the database refused, not one recomputed
  // here from a second, possibly different, read.
  const m = /needed (\d+) remaining (\d+)/.exec(message);
  const needed = m ? Number(m[1]) : 0;
  const remaining = m ? Number(m[2]) : 0;
  const detail = `SCAN_QUOTA_EXCEEDED needed=${needed} remaining=${remaining}`;
  if (!m)
    return new HttpError(
      402,
      "You've used all your scans for this period. Upgrade your plan to keep going.",
      detail,
    );
  return new HttpError(
    402,
    remaining === 0
      ? `This is ${needed} page${needed === 1 ? "" : "s"}. You have no scans left this period.`
      : `This is ${needed} page${needed === 1 ? "" : "s"}. You have ${remaining} scan${remaining === 1 ? "" : "s"} left.`,
    detail,
  );
}

function ledgerError(message: string): HttpError {
  if (message.includes("SCAN_QUOTA_EXCEEDED")) return quotaError(message);
  if (message.includes("NO_SUBSCRIPTION"))
    return new HttpError(
      402,
      "This account has no active plan. Choose a plan to keep going.",
    );
  if (message.includes("UPLOAD_NOT_FOUND"))
    return new HttpError(404, "An uploaded document could not be found.");
  console.error("page ledger call failed", message);
  return new HttpError(500, "Couldn't start the analysis. Please try again.");
}

/**
 * Reserves every page in `uploadIds` before a model call, all or nothing.
 *
 * All or nothing is the point. A teacher with 12 scans left who photographs a
 * class of 30 gets told so with nothing spent and nothing graded, rather than
 * 12 papers back and a bill for 12 with the rest of the stack still on the
 * desk.
 */
export async function chargePages(
  svc: ServiceClient,
  teacher: string,
  uploadIds: string[],
  mode: Mode,
  genKey: string | null = null,
): Promise<Charge> {
  const { data, error } = await svc.rpc("charge_pages", {
    p_teacher: teacher,
    p_upload_ids: uploadIds,
    p_mode: mode,
    p_gen_key: genKey,
  });
  if (error) throw ledgerError(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as
    | Record<string, number>
    | undefined;
  return {
    charged: Number(row?.charged ?? 0),
    alreadyPaid: Number(row?.already_paid ?? 0),
    used: Number(row?.used ?? 0),
    quota: Number(row?.quota ?? 0),
    remaining: Number(row?.remaining ?? 0),
  };
}

/** Work delivered. Idempotent, so a replayed poll confirms nothing new. */
export async function confirmPages(
  svc: ServiceClient,
  teacher: string,
  uploadIds: string[],
  genKey: string | null = null,
): Promise<void> {
  const { error } = await svc.rpc("confirm_pages", {
    p_teacher: teacher,
    p_upload_ids: uploadIds,
    p_gen_key: genKey,
  });
  // Never fatal. A page confirmed late reads as abandoned after two hours and
  // stops counting, which costs the teacher nothing; throwing here would
  // discard an analysis that already succeeded.
  if (error) console.error("confirm_pages failed", error.message);
}

/**
 * Gives back unconfirmed reservations after a failure or a cancelled stack.
 * Confirmed pages are never refunded, so one bad batch cannot undo the pages
 * that already graded.
 */
export async function releasePages(
  svc: ServiceClient,
  teacher: string,
  uploadIds: string[],
  genKey: string | null = null,
): Promise<number> {
  const { data, error } = await svc.rpc("release_pages", {
    p_teacher: teacher,
    p_upload_ids: uploadIds,
    p_gen_key: genKey,
  });
  if (error) {
    console.error("release_pages failed", error.message);
    return 0;
  }
  return Number(data ?? 0);
}
