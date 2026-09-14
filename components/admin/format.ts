export function fmtUsd(n: number | null | undefined, digits = 0) {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(n));
}

export function fmtBytes(b: number | null | undefined) {
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
export function fmtCents(n: number | null | undefined) {
  const v = Number(n ?? 0);
  if (v === 0) return "$0.00";
  if (Math.abs(v) < 0.005) return "under 1¢";
  return `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}`;
}

/** What each kind of AI call is, in words a non-engineer can read. */
export const STAGES: Record<string, { label: string; what: string; unit: string }> = {
  responses:  { label: "Student worksheet scan", what: "Reads one student's answers and checks them against the key", unit: "per student" },
  assignment: { label: "Assignment read",        what: "Reads the worksheet and matches each question to a standard", unit: "per assignment" },
  answer_key: { label: "Answer key read",        what: "Reads the teacher's answer key",                             unit: "per assignment" },
  lesson:     { label: "Lesson plan",            what: "Writes a reteaching lesson for a standard",                  unit: "per lesson" },
  reteaching: { label: "Reteaching material",    what: "Writes material aimed at one misconception",                 unit: "per group" },
  catalog:    { label: "Standards lookup",       what: "Looks up a state's official standards list",                 unit: "per state and grade" },
  roster:     { label: "Roster read",            what: "Reads student names off a roster photo",                     unit: "per roster" },
  support:    { label: "Support reply",          what: "Drafts a first reply to a help ticket",                      unit: "per ticket" },
  unknown:    { label: "Not recorded",           what: "Scans made before the type of work was tracked",             unit: "" },
};
export function stageInfo(stage: string | null | undefined) {
  return STAGES[stage ?? "unknown"] ?? { label: stage ?? "Not recorded", what: "", unit: "" };
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
  const d = (detail ?? {}) as Record<string, any>;
  const reason = d.reason ? ` — “${d.reason}”` : "";
  const cap = (s: unknown) => (typeof s === "string" && s ? s.charAt(0).toUpperCase() + s.slice(1) : String(s ?? ""));
  switch (action) {
    case "set_plan": return `Changed plan from ${cap(d.from)} to ${cap(d.to)}${reason}`;
    case "set_status": return `Set account status to ${cap(d.to ?? d.status)}${reason}`;
    case "grant_admin": return "Granted admin access (the account stays a teacher account too)";
    case "revoke_admin": return "Revoked admin access";
    case "set_admin": return d.to === true || d.is_admin === true || d.to === "true" ? "Granted admin access" : d.to === false || d.is_admin === false || d.to === "false" ? "Revoked admin access" : "Changed admin access";
    case "set_pipeline": { const to = d.to ?? {}; return `Set the ${d.stage ?? ""} stage to ${to.model ?? "?"} (${to.effort ?? "?"} reasoning, up to ${to.max ?? "?"} tokens)`.replace("the  stage", "this stage"); }
    case "clear_failed_scans": return `Cleared ${d.removed ?? 0} failed scan${d.removed === 1 ? "" : "s"}${d.cost_usd ? ` (${fmtCents(d.cost_usd)} had been spent on them)` : ""}`;
    case "remove_model": return `Removed ${d.model ?? ""} from the pricing table`.replace("Removed  from", "Removed a model from");
    case "internal_note": return "Updated the internal notes";
    case "reset_teacher": return `Reset the account’s classroom data${d.keep_scans === false ? " and scan history" : ""}`;
    case "review_reteaching": return `Marked a reteaching entry ${d.status ?? ""}${d.quality != null ? ` (quality ${d.quality})` : ""}`;
    case "reply_ticket": return `Replied to a support ticket${d.status ? ` and marked it ${d.status}` : ""}`;
    default: return cap(action.replace(/_/g, " "));
  }
}
