import {
  owningTeacherId,
  writingTeacherId,
  readDocument,
  deleteDocument,
  uploadStillReferenced,
  guardOrigin,
  apiError,
  HttpError,
} from "@/lib/teacher-server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ownerId = await owningTeacherId();
    const { id } = await params;
    const document = await readDocument(ownerId, id);
    if (!document) throw new HttpError(404, "Document not found.");
    return new Response(document.bytes, {
      headers: {
        "Content-Type": document.mime,
        "Content-Disposition":
          "inline; filename*=UTF-8''" + encodeURIComponent(document.name),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    guardOrigin(request);
    const ownerId = await writingTeacherId();
    const { id } = await params;
    // One row serves every identical file: never delete one something still
    // uses (a test, a resource, a scan in progress), whatever the caller checked.
    if (await uploadStillReferenced(ownerId, id))
      throw new HttpError(409, "This file is still used elsewhere, so it was kept.");
    if (!(await deleteDocument(ownerId, id)))
      throw new HttpError(404, "Document not found.");
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
