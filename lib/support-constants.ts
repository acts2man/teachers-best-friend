// Shared, client-safe vocabulary for the support ticketing system. Keeping
// labels here (rather than scattered through components) is what makes it
// cheap to rename a category or restyle a status later.

export const TICKET_CATEGORIES = [
  { value: "scanning", label: "Scanning & uploads" },
  { value: "grading", label: "Grading & standards" },
  { value: "lessons", label: "Lesson plans & reteaching" },
  { value: "billing", label: "Account & billing" },
  { value: "other", label: "Something else" },
] as const;

export const TICKET_PRIORITIES = [
  { value: "low", label: "Low — whenever you can" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High — this is blocking me" },
] as const;

export type TicketStatus =
  | "open"
  | "ai_answered"
  | "escalated"
  | "resolved"
  | "closed";

export const STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Open",
  ai_answered: "Answered",
  escalated: "Escalated",
  resolved: "Resolved",
  closed: "Closed",
};

// Tones map to the app's existing <Pill tone="…"> palette (green / amber /
// purple / neutral) so the ticket status reads consistently with every
// other status pill already used across the workspace.
export const STATUS_TONE: Record<TicketStatus, string> = {
  open: "amber",
  ai_answered: "purple",
  escalated: "amber",
  resolved: "green",
  closed: "neutral",
};

export type MessageAuthor = "teacher" | "ai" | "staff";

// Reporter-facing surfaces never show a real staff name — everyone who
// isn't the teacher themselves reads as one identity.
export function supportAuthorDisplay(author: MessageAuthor) {
  if (author === "teacher") return "You";
  if (author === "ai") return "AI first look";
  return "Teacher support";
}

export function categoryLabel(value: string | null) {
  return TICKET_CATEGORIES.find((c) => c.value === value)?.label ?? "General";
}
