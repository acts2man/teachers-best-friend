import {
  owner,
  readDocument,
  deleteDocument,
  guardOrigin,
  apiError,
  HttpError,
} from "@/lib/teacher-server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ownerId = await owner();
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
    const ownerId = await owner();
    const { id } = await params;
    if (!(await deleteDocument(ownerId, id)))
      throw new HttpError(404, "Document not found.");
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
