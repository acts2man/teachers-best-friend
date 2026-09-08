import {
  owner,
  saveDocument,
  guardOrigin,
  apiError,
  HttpError,
} from "@/lib/teacher-server";

export async function POST(request: Request) {
  try {
    guardOrigin(request);
    const ownerId = await owner();
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
    await saveDocument(ownerId, id, file, bytes);
    return Response.json({
      id,
      name: file.name,
      size: file.size,
      mime: file.type,
    });
  } catch (error) {
    return apiError(error);
  }
}
