import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { billingEnabled } from "@/lib/billing/config";
import { stripeClient } from "@/lib/billing/stripe";
import {
  runAccountDeletion,
  type AccountSteps,
  type DeletionReport,
} from "@/lib/account-deletion";

/** Same bucket for both the current uploads table and the legacy one. */
const DOCUMENT_BUCKET = "teacher-documents";

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * Stripe's way of saying "that subscription is not a live thing".
 *
 * Cancelling one that is already cancelled has to read as success, because the
 * second run of a resumed deletion will do exactly that, and treating it as a
 * failure would leave an account permanently undeletable.
 */
function alreadyGone(error: unknown): boolean {
  const e = error as { code?: string; statusCode?: number; message?: string };
  if (e?.code === "resource_missing") return true;
  if (e?.statusCode === 404) return true;
  return /no such subscription|already canceled|already cancelled/i.test(
    e?.message ?? "",
  );
}

/**
 * Removes a teacher's files from the bucket, then their upload rows.
 *
 * Service-role, not the teacher's own session: an admin acting on an LEA's
 * request is not the owner of these rows, and row-level security would (quite
 * correctly) refuse them. It covers `teacher_uploads` and the legacy `uploads`
 * table, which share the one bucket.
 *
 * Storage first. `deleteAllDocuments` in lib/teacher-server.ts does the same
 * for the teacher's own "delete my workspace data" button; this is its
 * service-role twin rather than a second implementation of the idea -- the
 * only difference is who is asking.
 */
export async function purgeTeacherDocuments(
  svc: ServiceClient,
  teacherId: string,
): Promise<number> {
  const paths = new Set<string>();

  const { data: current, error: currentError } = await svc
    .from("teacher_uploads")
    .select("object_path")
    .eq("owner_id", teacherId);
  if (currentError) throw currentError;
  for (const row of current ?? []) if (row.object_path) paths.add(row.object_path);

  const { data: legacy, error: legacyError } = await svc
    .from("uploads")
    .select("object_path")
    .eq("teacher_id", teacherId);
  if (legacyError) throw legacyError;
  for (const row of legacy ?? []) if (row.object_path) paths.add(row.object_path);

  if (paths.size) {
    const { error } = await svc.storage
      .from(DOCUMENT_BUCKET)
      .remove([...paths]);
    // A file that is already gone is not an error here: the whole point is to
    // end up with none of them, and a resumed deletion starts from a bucket
    // the first attempt may have half-emptied.
    if (error && !/not found/i.test(error.message)) throw error;
  }

  // The rows themselves are deleted by delete_teacher_account, in the same
  // transaction as everything else it removes.
  return paths.size;
}

/** The real steps, wired to Supabase and Stripe. */
function stepsFor(
  svc: ServiceClient,
  teacherId: string,
  actorId: string | null,
): AccountSteps {
  return {
    async stripeSubscriptionId() {
      const { data, error } = await svc
        .from("subscriptions")
        .select("stripe_subscription_id")
        .eq("teacher_id", teacherId)
        .maybeSingle();
      if (error) throw error;
      return data?.stripe_subscription_id ?? null;
    },

    billingEnabled,

    async cancelSubscription(id: string) {
      try {
        await stripeClient().subscriptions.cancel(id);
        return "canceled";
      } catch (e) {
        if (alreadyGone(e)) return "already-canceled";
        throw e;
      }
    },

    purgeDocuments: () => purgeTeacherDocuments(svc, teacherId),

    async deleteRows() {
      // The admin door re-checks is_admin inside the database, the same way
      // every other admin_* function does. The app-layer check is belt.
      const { data, error } = actorId
        ? await svc.rpc("admin_delete_teacher_account", {
            p_actor: actorId,
            p_teacher: teacherId,
          })
        : await svc.rpc("delete_teacher_account", { p_teacher: teacherId });
      if (error) throw new Error(error.message);
      const row = (data ?? {}) as { plan?: string | null; scans_unlinked?: number };
      return { plan: row.plan ?? null, scansUnlinked: Number(row.scans_unlinked ?? 0) };
    },

    async deleteAuthUser() {
      const { error } = await svc.auth.admin.deleteUser(teacherId);
      if (!error) return "deleted";
      // Resuming a deletion that already got this far.
      if (/not found/i.test(error.message)) return "already-gone";
      throw new Error(error.message);
    },
  };
}

/**
 * Delete one teacher's account.
 *
 * `actorId` is the admin doing it on an LEA's request, or null when the
 * teacher did it themselves. Safe to call again after a failure: every step
 * tolerates having already run.
 */
export async function deleteTeacherAccount(
  teacherId: string,
  opts: { actorId?: string | null } = {},
): Promise<DeletionReport> {
  const svc = createServiceClient();
  return runAccountDeletion(stepsFor(svc, teacherId, opts.actorId ?? null));
}

/** The email on the account, for the confirmation check. */
export async function accountEmail(teacherId: string): Promise<string> {
  const svc = createServiceClient();
  const { data, error } = await svc.auth.admin.getUserById(teacherId);
  if (error) throw new Error(error.message);
  return data?.user?.email ?? "";
}
