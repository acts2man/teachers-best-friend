import { apiError } from "@/lib/teacher-server";
import { requireAppManagerId } from "@/lib/admin-gate";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

/**
 * The accounts an app manager may view, for the picker in the teacher app's
 * sidebar.
 *
 * Read through the service client on purpose. admin_accounts is only
 * reachable with elevated rights, and a teacher reading the table directly
 * under row-level security would get back just themselves — which shows up
 * as an empty picker rather than an error, and is nearly impossible to
 * diagnose from the UI.
 */
export async function GET() {
  try {
    const actor = await requireAppManagerId();
    const { data, error } = await supabaseAdmin()
      .from("admin_accounts")
      .select("teacher_id, email, full_name, school_name, status, last_seen_at")
      .order("last_seen_at", { ascending: false, nullsFirst: false })
      .limit(500);
    if (error) throw new Error(error.message);

    return Response.json(
      {
        // Never offer the viewer their own account: start_impersonation
        // raises CANNOT_IMPERSONATE_SELF, so it would only ever be a dead row.
        teachers: (data ?? [])
          .filter((t) => t.teacher_id !== actor)
          .map((t) => ({
            id: t.teacher_id,
            email: t.email ?? "",
            name: t.full_name ?? "",
            school: t.school_name ?? "",
            status: t.status ?? "active",
            lastSeenAt: t.last_seen_at,
          })),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
