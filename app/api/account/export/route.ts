import {
  apiError,
  HttpError,
  owningTeacherId,
  readWorkspace,
} from "@/lib/teacher-server";
import { buildExportCsv, buildExportJson } from "@/lib/account-export";
import type { Workspace } from "@/lib/teacher-types";

/**
 * Download my data.
 *
 * Built server-side from what we store, not from the copy the browser is
 * holding: an export is a claim about our records, and it should be able to
 * disagree with a stale tab rather than quietly agree with it.
 *
 * `?format=csv` returns one row per piece of standards evidence; anything else
 * returns the whole workspace as JSON. Neither carries an image or a reference
 * to one -- see lib/account-export.ts for why that is a feature.
 */
export async function GET(request: Request) {
  try {
    const teacherId = await owningTeacherId();
    const saved = await readWorkspace(teacherId);
    if (!saved) throw new HttpError(404, "There is nothing saved to export yet.");
    const workspace = saved.data as Workspace;

    const format = new URL(request.url).searchParams.get("format");
    const stamp = new Date().toISOString().slice(0, 10);

    if (format === "csv") {
      return new Response(buildExportCsv(workspace), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="students-and-evidence-${stamp}.csv"`,
          "Cache-Control": "private, no-store",
        },
      });
    }

    const body = JSON.stringify(
      buildExportJson(workspace, { generatedAt: new Date().toISOString() }),
      null,
      2,
    );
    return new Response(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="teachers-best-friend-${stamp}.json"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
