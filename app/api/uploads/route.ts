import {
  writingTeacherId,
  owningTeacherId,
  saveDocument,
  findUploadByHash,
  guardOrigin,
  apiError,
  HttpError,
} from "@/lib/teacher-server";

/**
 * Recovers an upload by the hash of its content. The client falls back to this
 * when the POST reply above could not be read (a compressed body a hop between
 * the function and the page never decoded): the file may already be stored, and
 * looking it up by content lets the teacher carry on without a duplicate upload
 * or a second charge. Read-only and owner-scoped.
 */
export async function GET(request: Request) {
  try {
    const ownerId = await owningTeacherId();
    const sha256 = new URL(request.url).searchParams.get("sha256") ?? "";
    if (!/^[0-9a-f]{64}$/.test(sha256))
      throw new HttpError(400, "Provide the file's content hash.");
    const found = await findUploadByHash(ownerId, sha256);
    if (!found) throw new HttpError(404, "No matching upload.");
    return Response.json(found);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    guardOrigin(request);
    const ownerId = await writingTeacherId();
    if (Number(request.headers.get("content-length")) > 9 * 1024 * 1024)
      throw new HttpError(413, "Please choose a file smaller than 8 MB.");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size)
      throw new HttpError(400, "Choose a PDF or image first.");
    if (file.size > 8 * 1024 * 1024)
      throw new HttpError(413, "Please choose a file smaller than 8 MB.");
    if (
      !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(
        file.type,
      )
    )
      throw new HttpError(400, "Use a PDF, JPG, PNG, or WebP file.");
    const bytes = await file.arrayBuffer();
    const header = new Uint8Array(bytes.slice(0, 12));
    const valid =
      file.type === "application/pdf"
        ? String.fromCharCode(...header.slice(0, 5)) === "%PDF-"
        : file.type === "image/png"
          ? header[0] === 137 &&
            header[1] === 80 &&
            header[2] === 78 &&
            header[3] === 71
          : file.type === "image/jpeg"
            ? header[0] === 255 && header[1] === 216
            : file.type === "image/webp"
              ? String.fromCharCode(...header.slice(0, 4)) === "RIFF" &&
                String.fromCharCode(...header.slice(8, 12)) === "WEBP"
              : false;
    if (!valid)
      throw new HttpError(
        400,
        "This file doesn’t match its format. Try exporting it again.",
      );
    const id = crypto.randomUUID();
    // pages comes back from the server's own count of the bytes, never from
    // the browser. The client shows it so a teacher can see what a stack will
    // cost before committing to it; the charge is worked out from the stored
    // column regardless of what the client does with this number.
    const { pageCount } = await saveDocument(ownerId, id, file, bytes);
    return Response.json({
      id,
      name: file.name,
      size: file.size,
      mime: file.type,
      pages: pageCount,
    });
  } catch (error) {
    return apiError(error);
  }
}
