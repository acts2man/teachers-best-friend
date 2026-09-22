import { requireAdminApi } from "@/lib/admin-gate";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { apiError, HttpError, readWorkspace } from "@/lib/teacher-server";
import { buildExportCsv, buildExportJson } from "@/lib/account-export";
import type { Workspace } from "@/lib/teacher-types";

/**
 * A teacher's data, taken by an admin on a school's request.
 *
 * This is the door that exists so the other one can be closed. An app manager
 * viewing a teacher's account can no longer download it -- see
 * downloadingTeacherId() -- because that left no record of the copy having
 * been taken. This route does the same job and writes the line:
 *
 *   action      export_teacher_data
 *   actor_id    the admin, from is_admin(), not from anything the request said
 *   target_id   the teacher
 *   detail      the format and how many rows, and nothing else
 *
 * The detail deliberately carries counts rather than content. An audit log
 * that quoted what it was auditing would become a second copy of the thing it
 * exists to keep track of, and one that nobody ever deletes.
 *
 * Same builder as the teacher's own download, so the two cannot drift: what a
 * district receives is exactly what the teacher would have received.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ teacherId: string }> },
) {
  try {
    // Throws 401/403 rather than redirecting: this is a fetch, and
    // requireAdmin()'s redirect() would be caught by the catch below and
    // rendered as a 503 outage message to someone who is simply not an admin.
    const admin = await requireAdminApi();
    const { teacherId } = await context.params;

    const saved = await readWorkspace(teacherId);
    if (!saved) throw new HttpError(404, "That account has nothing saved to export.");
    const workspace = saved.data as Workspace;

    const url = new URL(_request.url);
    const format = url.searchParams.get("format") === "csv" ? "csv" : "json";
    const stamp = new Date().toISOString().slice(0, 10);

    const body =
      format === "csv"
        ? buildExportCsv(workspace)
        : JSON.stringify(
            buildExportJson(workspace, { generatedAt: new Date().toISOString() }),
            null,
            2,
          );

    // Logged before it is handed over, so a download that fails on the way out
    // is still a download that was authorised and attempted.
    const { error } = await supabaseAdmin().rpc("admin_log", {
      p_actor: admin.id,
      p_action: "export_teacher_data",
      p_target_type: "teacher",
      p_target_id: teacherId,
      p_detail: {
        format,
        classes: workspace.classes?.length ?? 0,
        students: workspace.students?.length ?? 0,
        assessments: workspace.assessments?.length ?? 0,
      },
    });
    if (error) {
      // Refuse rather than hand over an unlogged copy. An export nobody can
      // account for afterwards is the exact thing this route was added to stop.
      console.error("Admin export audit write failed", error.message);
      throw new HttpError(
        503,
        "The export could not be recorded in the audit log, so it was not produced. Please try again.",
      );
    }

    return new Response(body, {
      headers: {
        "Content-Type":
          format === "csv"
            ? "text/csv; charset=utf-8"
            : "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="teacher-${teacherId.slice(0, 8)}-${stamp}.${format}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
