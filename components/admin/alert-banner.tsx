import { AlertTriangle, Check } from "lucide-react";
import { acknowledgeAlert } from "@/app/admin/actions";
import type { PlatformAlert } from "@/lib/supabase-admin";
import { fmtRel } from "./format";

/**
 * The things an operator has to see before anything else on the page.
 *
 * Not the "needs attention" list further down -- that is a to-do list of
 * ordinary work. These are conditions where the app is not functioning for
 * teachers and no teacher can do anything about it: the AI account out of
 * credit, a spend ceiling reached. Until there is real error reporting, this
 * banner is the whole alarm.
 *
 * It renders nothing when there is nothing wrong, so it never becomes
 * furniture that gets read past.
 */
const LABELS: Record<string, string> = {
  out_of_credit: "AI account out of credit",
  platform_cost_cap: "Daily spend ceiling reached",
  teacher_cost_cap: "A teacher hit their daily limit",
};

/** How bad. out_of_credit and the platform cap stop every teacher at once. */
function severity(kind: string) {
  return kind === "teacher_cost_cap" ? "warn" : "bad";
}

export function AlertBanner({ alerts }: { alerts: PlatformAlert[] }) {
  if (!alerts.length) return null;
  return (
    <section className="ad-alerts" aria-label="Platform alerts">
      {alerts.map((a) => (
        <div key={a.id} className={`ad-alert is-${severity(a.kind)}`} role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <div className="ad-alert-body">
            <strong>{LABELS[a.kind] ?? a.kind}</strong>
            <p>{a.message}</p>
            <span className="ad-alert-when">{fmtRel(a.created_at)}</span>
          </div>
          {/* A server action, like every other admin write. Acknowledging
              hides it but keeps the row, so the history of what went wrong
              survives someone clearing the banner. */}
          <form action={acknowledgeAlert}>
            <input type="hidden" name="alert_id" value={a.id} />
            <button type="submit" className="ad-alert-ack">
              <Check size={15} aria-hidden="true" />
              Acknowledge
            </button>
          </form>
        </div>
      ))}
    </section>
  );
}
