// Postgres numeric columns arrive from PostgREST as strings, not numbers
// (teacher_unit_economics.ai_cost_usd, scans.cost_usd, admin_platform_stats
// .mrr_usd and friends). Both of these already coerced with Number(); the
// signatures just claimed otherwise, so every call site either widened the
// value to `any` or lied about it. Accept what the API actually sends.
export type Numeric = number | string | null | undefined;

export function fmtUsd(n: Numeric, digits = 0) {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(n));
}

export function fmtBytes(b: Numeric) {
  const n = Number(b ?? 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function fmtRel(iso: string | null | undefined) {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 14) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function fmtInt(n: number | null | undefined) {
  return new Intl.NumberFormat("en-US").format(Number(n ?? 0));
}

/** Money for a layperson: whole cents, or "under 1¢". Use `title` with fmtUsd(n, 4) for the exact figure. */
export function fmtCents(n: Numeric) {
  const v = Number(n ?? 0);
  if (v === 0) return "$0.00";
  if (Math.abs(v) < 0.005) return "under 1¢";
  return `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}`;
}

/**
 * A per-scan or per-call figure. These land between a tenth of a cent and a
 * few cents, where fmtCents rounds everything interesting away: 3.7¢ and 0.2¢
 * both become "$0.04" / "under 1¢", so a teacher cannot tell an expensive
 * pipeline from a cheap one. Show the cents themselves.
 * Anything at a dollar or more falls back to dollars, where cents stop helping.
 */
export function fmtPerScan(n: Numeric) {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v) || v === 0) return "$0.00";  // Kpi reads this as its empty state
  if (Math.abs(v) >= 1) return fmtUsd(v, 2);
  const cents = v * 100;
  return `${cents.toFixed(Math.abs(cents) >= 1 ? 1 : 2)}¢`;
}

/** What each kind of AI call is, in words a non-engineer can read. */
export const STAGES: Record<string, { label: string; what: string; unit: string }> = {
  responses:  { label: "Student worksheet scan", what: "Reads one student's answers and checks them against the key", unit: "per student" },
  assignment: { label: "Assignment read",        what: "Reads the worksheet and matches each question to a standard", unit: "per assignment" },
  answer_key: { label: "Answer key read",        what: "Reads the teacher's answer key",                             unit: "per assignment" },
  lesson:     { label: "Lesson plan",            what: "Writes a reteaching lesson for a standard",                  unit: "per lesson" },
  reteaching: { label: "Reteaching material",    what: "Writes material aimed at one misconception",                 unit: "per group" },
  class_scan: { label: "Whole-class scan",       what: "Grades a stack of pages, with student names already removed", unit: "per stack of pages" },
  name_strip: { label: "Name check",             what: "Reads just the name line off each page, so grading never sees it", unit: "per stack of pages" },
  catalog:    { label: "Standards lookup",       what: "The app's own setup work, not a teacher scan — looks up a state's official standards list", unit: "per state and grade" },
  roster:     { label: "Roster read",            what: "Reads student names off a roster photo",                     unit: "per roster" },
  support:    { label: "Support reply",          what: "Drafts a first reply to a help ticket",                      unit: "per ticket" },
  embedding:  { label: "Standards matching",     what: "Turns wording into the numbers used to match it to a standard", unit: "per lookup" },
  unknown:    { label: "Not recorded",           what: "Scans made before the type of work was tracked",             unit: "" },
};
/**
 * Never leak a raw pipeline_config stage name into the admin UI — these pages
 * are read by non-engineers. A stage added to pipeline_config but not yet given
 * an entry above at least reads as English ("class_scan" -> "Class scan").
 */
export function stageInfo(stage: string | null | undefined) {
  const key = stage ?? "unknown";
  const known = STAGES[key];
  if (known) return known;
  return {
    label: key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
    what: "A kind of AI work that has not been given a plain-English name yet",
    unit: "",
  };
}

/** "gpt-5.6-luna" → "GPT-5.6 Luna" */
export function modelLabel(model: string | null | undefined) {
  if (!model) return "—";
  const m = model.match(/^gpt-([\d.]+)-?(.*)$/);
  if (!m) return model;
  const suffix = m[2] ? " " + m[2].charAt(0).toUpperCase() + m[2].slice(1) : "";
  return `GPT-${m[1]}${suffix}`;
}

/** Turns an audit-log row into one readable sentence. Falls back to the action name. */
export function describeAudit(action: string, detail: Record<string, unknown> | null | undefined) {
  const d = (detail ?? {}) as Record<string, unknown>;
  const reason = d.reason ? ` — “${d.reason}”` : "";
  const cap = (s: unknown) => (typeof s === "string" && s ? s.charAt(0).toUpperCase() + s.slice(1) : String(s ?? ""));
  // Audit details are free-form jsonb; read nested fields defensively rather
  // than asserting a shape the database does not enforce.
  const bag = (v: unknown): Record<string, unknown> =>
    v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);
  const money = (v: unknown): Numeric =>
    typeof v === "number" || typeof v === "string" ? v : undefined;
  switch (action) {
    case "set_plan": return `Changed plan from ${cap(d.from)} to ${cap(d.to)}${reason}`;
    case "set_status": return `Set account status to ${cap(d.to ?? d.status)}${reason}`;
    case "grant_admin": return "Granted admin access (the account stays a teacher account too)";
    case "revoke_admin": return "Revoked admin access";
    case "set_admin": return d.to === true || d.is_admin === true || d.to === "true" ? "Granted admin access" : d.to === false || d.is_admin === false || d.to === "false" ? "Revoked admin access" : "Changed admin access";
    case "set_pipeline": { const to = bag(d.to); return `Set the ${d.stage ?? ""} stage to ${to.model ?? "?"} (${to.effort ?? "?"} reasoning, up to ${to.max ?? "?"} tokens)`.replace("the  stage", "this stage"); }
    case "clear_failed_scans": return `Cleared ${d.removed ?? 0} failed scan${d.removed === 1 ? "" : "s"}${money(d.cost_usd) ? ` (${fmtCents(money(d.cost_usd))} had been spent on them)` : ""}`;
    case "remove_model": return `Removed ${d.model ?? ""} from the pricing table`.replace("Removed  from", "Removed a model from");
    case "internal_note": return "Updated the internal notes";
    case "reset_teacher": return `Reset the account’s classroom data${d.keep_scans === false ? " and scan history" : ""}`;
    case "review_reteaching": return `Marked a reteaching entry ${d.status ?? ""}${num(d.quality) != null ? ` (quality ${num(d.quality)})` : ""}`;
    case "reply_ticket": return `Replied to a support ticket${d.status ? ` and marked it ${d.status}` : ""}`;
    case "set_ticket_priority": return `Set a support ticket’s priority to ${d.priority ?? "?"}`;
    case "start_impersonation": return "Started viewing a teacher’s account as an app manager";
    case "stop_impersonation": return "Stopped viewing a teacher’s account";
    case "set_app_manager": return d.to === true ? "Granted app manager access" : d.to === false ? "Revoked app manager access" : "Changed app manager access";
    default: return cap(action.replace(/_/g, " "));
  }
}
