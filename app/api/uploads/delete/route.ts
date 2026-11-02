import { z } from "zod";
import {
  writingTeacherId,
  deleteDocument,
  uploadsStillReferenced,
  guardOrigin,
  apiError,
  HttpError,
} from "@/lib/teacher-server";

/**
 * Deletes several uploads at once: POST { ids } ->
 *   { deleted, missing, failed, kept: [{ id, by, assessmentIds?, leftover? }] }
 *
 * What is still in use is checked once for the whole list -- one workspace
 * read, one read of the scans in progress (#187 review) -- and nothing in use
 * is deleted, whatever the caller checked. `kept` says why, so the app can
 * clear a scan left behind by a deleted test and ask again (lib/connection.ts
 * deleteUploads).
 */
const input = z.object({
  ids: z.array(z.string().min(1).max(200)).min(1).max(500),
});

export async function POST(request: Request) {
  try {
    guardOrigin(request);
    const ownerId = await writingTeacherId();
    const parsed = input.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Choose the files to delete.");
    const ids = [...new Set(parsed.data.ids)];
    const inUse = await uploadsStillReferenced(ownerId, ids);
    const deleted: string[] = [];
    const missing: string[] = [];
    const failed: string[] = [];
    for (const id of ids) {
      if (inUse.has(id)) continue;
      try {
        if (await deleteDocument(ownerId, id)) deleted.push(id);
        else missing.push(id);
      } catch {
        failed.push(id);
      }
    }
    const kept = [...inUse].map(([id, use]) => ({ id, ...use }));
    return Response.json({ deleted, missing, failed, kept }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
