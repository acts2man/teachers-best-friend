import "server-only";
import { HttpError } from "@/lib/http-error";
import type { createServiceClient } from "@/lib/supabase/service";
import { alertPlatformCap, alertTeacherCap } from "@/lib/platform-alerts";
import { TEACHER_MESSAGES } from "@/lib/ai-retry";

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * The money ceilings, checked before anything is spent.
 *
 * The page ledger caps pages, which is the unit a teacher thinks in. It is not
 * a cap on dollars: a dense PDF at high detail, a client stuck in a loop, or a
 * mistake in the pricing table all stay inside the page quota while costing
 * many times what a page normally costs.
 *
 * This runs BEFORE chargePages and before the model call, so a blocked request
 * spends nothing and leaves nothing to unwind -- no page charge to release, no
 * provider call to pay for.
 */

export type GateResult = {
  blocked: boolean;
  reason: "platform" | "teacher" | null;
  cap: number | null;
  spent: number | null;
};

/**
 * Asks the database which ceiling, if any, applies right now.
 *
 * `exempt` covers admin standards loads: those unlock a library every teacher
 * shares, so they are not the admin's own usage and do not come out of their
 * cap. They still count toward the platform total, because the money was
 * still spent.
 */
export async function checkSpendGate(
  svc: ServiceClient,
  teacher: string,
  exempt: boolean,
): Promise<GateResult> {
  const { data, error } = await svc.rpc("spend_gate", {
    p_teacher: teacher,
    p_exempt: exempt,
  });
  if (error) {
    // Fail open, loudly. A database hiccup in the safety check should not stop
    // a teacher grading: the page quota still bounds the damage, and these
    // ceilings are ten times normal use. Silently blocking everyone would be
    // the worse failure.
    console.error("spend_gate failed", error.code ?? "", error.message);
    return { blocked: false, reason: null, cap: null, spent: null };
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { blocked?: boolean; reason?: string | null; cap_usd?: number | null; spent_usd?: number | null }
    | undefined;
  return {
    blocked: Boolean(row?.blocked),
    reason: (row?.reason as GateResult["reason"]) ?? null,
    cap: row?.cap_usd === null || row?.cap_usd === undefined ? null : Number(row.cap_usd),
    spent: row?.spent_usd === null || row?.spent_usd === undefined ? null : Number(row.spent_usd),
  };
}

/**
 * Throws the right refusal when a ceiling is hit, and files the alert.
 *
 * The two read very differently to a teacher on purpose. Their own cap is
 * something they did and can plan around, and it says when it lifts. The
 * platform cap is not their fault and not theirs to fix, so it borrows the
 * same wording as an outage rather than implying they did something.
 */
export async function enforceSpendGate(
  gate: GateResult,
  teacher: string,
): Promise<void> {
  if (!gate.blocked) return;

  if (gate.reason === "platform") {
    await alertPlatformCap(gate.cap ?? 0, gate.spent ?? 0);
    throw new HttpError(
      503,
      TEACHER_MESSAGES.out_of_credit,
      `platform daily cap ${gate.cap} reached, spent ${gate.spent}`,
    );
  }

  await alertTeacherCap(teacher, gate.cap ?? 0, gate.spent ?? 0);
  throw new HttpError(
    429,
    "You've reached today's safety limit. It resets at midnight Pacific. Contact support if you need more today.",
    `teacher daily cap ${gate.cap} reached, spent ${gate.spent}`,
  );
}
