/**
 * What an app manager is not allowed to do while looking at someone else's
 * account, and the sentence they see when they try.
 *
 * Its own module, with no imports, for two reasons. It is testable on its own,
 * which the version living inside lib/teacher-server.ts was not -- that file
 * pulls in next/headers, Supabase and the workspace RPCs, so the rule could
 * only ever be checked by reading the source. And there is now more than one
 * kind of refusal, which is exactly when a rule starts drifting into two
 * slightly different rules in two places.
 *
 * The rule itself: the refusal turns on the PRESENCE of the impersonation
 * cookie, never on whether the session behind it still resolves. A session
 * expires after 30 minutes. If it lapses mid-view, resolveOwningTeacher()
 * quietly falls back to the manager's own id while the browser is still
 * holding the teacher's classroom -- so "does it still resolve" is the one
 * test that fails open, and fails open into someone else's account.
 */

export type GuardedAction = "write" | "download";

export const IMPERSONATION_REFUSALS: Record<GuardedAction, string> = {
  write:
    "You’re viewing another teacher’s account, so changes are turned off. " +
    "Stop viewing to make changes of your own.",
  // Reading a teacher's classroom on screen is what a view-as session is for,
  // and it is logged when it starts. Taking a copy of it away as a file is a
  // different act: it leaves the session, it outlives it, and nothing about
  // the download appears in the audit log. A school asking for a teacher's
  // data has an audited admin door for exactly this.
  download:
    "You’re viewing another teacher’s account, so downloads are turned off. " +
    "Stop viewing to download your own data.",
};

/** The sentence to refuse with, or null when there is nothing to refuse. */
export function impersonationRefusal(
  cookie: string | null | undefined,
  action: GuardedAction,
): string | null {
  return cookie ? IMPERSONATION_REFUSALS[action] : null;
}
