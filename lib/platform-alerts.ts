import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Telling an operator about something no teacher can fix.
 *
 * There is no Sentry yet. Until there is, these go to a table and a banner on
 * the admin dashboard, because the alternative is what already happened once:
 * a condition affecting every teacher at the same time, visible only in logs
 * nobody was reading, found out about from a teacher's message.
 *
 * Every alert in the app goes through this module, so adding Sentry later is
 * an edit here rather than a hunt through the routes.
 */

export type AlertKind =
  | "out_of_credit"
  | "platform_cost_cap"
  | "teacher_cost_cap";

/**
 * Files an alert. Never throws.
 *
 * An alert is a message about a failure; if it fails in turn, that must not
 * take down the request that was trying to report it. The worst case is a
 * missing banner, which is where we already were.
 *
 * `dedupeKey` collapses a repeating condition to one row. Without it, a
 * teacher who hits their daily cap at nine in the morning files an alert every
 * time they press Grade for the rest of the day, and the banner that was meant
 * to make one problem visible hides the rest.
 */
export async function recordAlert(
  kind: AlertKind,
  message: string,
  detail?: Record<string, unknown>,
  dedupeKey?: string,
): Promise<void> {
  try {
    const { error } = await createServiceClient().rpc("record_platform_alert", {
      p_kind: kind,
      p_message: message,
      p_detail: detail ?? null,
      p_dedupe_key: dedupeKey ?? null,
    });
    if (error) console.error("record_platform_alert failed", error.message);
  } catch (e) {
    console.error(
      "record_platform_alert threw",
      e instanceof Error ? e.message : String(e),
    );
  }
  // Also to the platform log, which is where an operator looks first and the
  // only place this shows up if the database is the thing that is broken.
  console.error(`PLATFORM ALERT [${kind}] ${message}`);
}

/** Today, in the timezone the caps are measured in. Keeps dedupe keys aligned with them. */
function pacificDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * The AI account has no credit left.
 *
 * The loudest thing in here. It is not one teacher's problem: every scan on
 * the platform fails the same way until someone adds funds, and nothing in the
 * app can recover on its own. Deduped per day so a busy morning files one
 * alert rather than hundreds.
 */
export async function alertOutOfCredit(detail: string): Promise<void> {
  await recordAlert(
    "out_of_credit",
    "The OpenAI account is out of credit. Every scan is failing until it is topped up.",
    { provider_detail: detail.slice(0, 500) },
    `out_of_credit:${pacificDay()}`,
  );
}

/** Everyone is paused because today's total spend hit its ceiling. */
export async function alertPlatformCap(
  cap: number,
  spent: number,
): Promise<void> {
  await recordAlert(
    "platform_cost_cap",
    `Today's platform AI spend reached its $${cap.toFixed(2)} ceiling. All scans are paused until midnight Pacific.`,
    { cap_usd: cap, spent_usd: spent },
    `platform_cost_cap:${pacificDay()}`,
  );
}

/**
 * One teacher reached their own daily ceiling.
 *
 * Far less serious -- it stops one person, not the platform -- but worth
 * seeing, because at these limits it means either a genuinely huge day or
 * something looping. One per teacher per day.
 */
export async function alertTeacherCap(
  teacherId: string,
  cap: number,
  spent: number,
): Promise<void> {
  await recordAlert(
    "teacher_cost_cap",
    `A teacher reached their $${cap.toFixed(2)} daily safety limit.`,
    { teacher_id: teacherId, cap_usd: cap, spent_usd: spent },
    `teacher_cost_cap:${teacherId}:${pacificDay()}`,
  );
}
