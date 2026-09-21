/**
 * The order in which an account comes apart, and nothing else.
 *
 * No Supabase, no Stripe, no imports at all. Deleting an account is a sequence
 * where the order is the whole safety argument -- cancel the money first, and
 * never delete an account that will keep being charged -- so the sequence is
 * written somewhere a test can run it end to end in a millisecond with every
 * step failing on purpose. lib/account-deletion-server.ts builds the real
 * steps; this decides what happens in what order and what a failure means.
 */

/** Each step is separately resumable: run it twice and the second is a no-op. */
export type AccountSteps = {
  /** The Stripe subscription id on file, or null if there has never been one. */
  stripeSubscriptionId(): Promise<string | null>;
  /** Whether Stripe is configured on this deployment at all. */
  billingEnabled(): boolean;
  /** Cancel immediately. Resolves "already-canceled" if Stripe has no such live subscription. */
  cancelSubscription(id: string): Promise<"canceled" | "already-canceled">;
  /** Storage objects and upload rows. Returns how many files were removed. */
  purgeDocuments(): Promise<number>;
  /** The database half: unlink the scans, delete everything owned, write the audit line. */
  deleteRows(): Promise<{ plan: string | null; scansUnlinked: number }>;
  /** The auth user. "already-gone" when a previous attempt got this far. */
  deleteAuthUser(): Promise<"deleted" | "already-gone">;
};

export type DeletionReport = {
  plan: string | null;
  scansUnlinked: number;
  documentsRemoved: number;
  stripe: "canceled" | "already-canceled" | "none" | "unreachable";
  authUser: "deleted" | "already-gone";
};

/**
 * Thrown when we stop before deleting anything. The teacher sees `message`;
 * `detail` is for the log.
 */
export class DeletionRefused extends Error {
  readonly status: number;
  readonly detail: string;
  constructor(status: number, message: string, detail = "") {
    super(message);
    this.name = "DeletionRefused";
    this.status = status;
    this.detail = detail;
  }
}

export const STRIPE_REFUSAL =
  "We couldn’t cancel your subscription, so nothing has been deleted. " +
  "Please try again in a few minutes, or contact support — we will not delete " +
  "an account that would keep being charged.";

export const UNREACHABLE_REFUSAL =
  "This account has a subscription we can’t reach right now, so nothing has " +
  "been deleted. Please contact support.";

/**
 * Cancel, then documents, then rows, then the auth user.
 *
 * Why this order and not any other:
 *
 * - Stripe first, and a failure there stops everything. A deleted account that
 *   is still billed monthly is the one outcome nobody can undo from inside
 *   this app, and the teacher would have no login left to notice it with.
 * - Documents before rows, because the upload rows are the index of which
 *   files exist. Delete the rows first and the photographs are orphaned in the
 *   bucket with nothing left pointing at them.
 * - Rows before the auth user, because the row deletion is ours and the auth
 *   deletion is a call to someone else's service. If that call fails, what is
 *   left behind is a login with nothing under it -- not a child's work.
 *
 * Every step tolerates having already run, so a deletion that dies halfway
 * finishes correctly when it is run again rather than erroring on what is
 * already gone.
 */
export async function runAccountDeletion(
  steps: AccountSteps,
): Promise<DeletionReport> {
  let stripe: DeletionReport["stripe"] = "none";
  const subscriptionId = await steps.stripeSubscriptionId();

  if (subscriptionId) {
    if (!steps.billingEnabled()) {
      // With billing switched off, stripe_subscription_id is null on every row
      // in the table. Finding one anyway means the deployment lost its keys
      // while a subscription was live, and we have no way to cancel it. That
      // is a stop, not a shrug.
      throw new DeletionRefused(
        503,
        UNREACHABLE_REFUSAL,
        `subscription ${subscriptionId} on file while billing is disabled`,
      );
    }
    try {
      stripe = await steps.cancelSubscription(subscriptionId);
    } catch (e) {
      throw new DeletionRefused(
        502,
        STRIPE_REFUSAL,
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  const documentsRemoved = await steps.purgeDocuments();
  const { plan, scansUnlinked } = await steps.deleteRows();
  const authUser = await steps.deleteAuthUser();

  return { plan, scansUnlinked, documentsRemoved, stripe, authUser };
}

/**
 * Does what they typed name the account they are signed in to?
 *
 * Case and surrounding space are forgiven -- a phone keyboard capitalises the
 * first letter of everything, and refusing on that teaches people to paste
 * rather than to read. Nothing else is: this is the one deliberate act that
 * separates a teacher from every record they have.
 */
export function emailsMatch(typed: string, actual: string): boolean {
  const a = typed.trim().toLowerCase();
  const b = actual.trim().toLowerCase();
  return a.length > 0 && b.length > 0 && a === b;
}
