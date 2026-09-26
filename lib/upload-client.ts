import { readJson } from "@/lib/utils";
import { contentHash } from "@/lib/content-hash";

/** What POST /api/uploads returns for one stored file. */
export type UploadResult = {
  id: string;
  name: string;
  size: number;
  mime: string;
  pages: number;
};

/**
 * Uploads one file and returns the stored record, surviving a reply the browser
 * can't read.
 *
 * The upload response is a few hundred bytes of JSON. A teacher hit it coming
 * back as raw brotli -- "Unexpected token '', "8Ģk{"... is not valid JSON" --
 * because something between the function and the page (a CDN re-compressing, a
 * browser extension stripping Content-Encoding but leaving the body compressed)
 * handed the page bytes it never decoded. `no-transform` on the response tells
 * those hops to leave small JSON alone, but we cannot police every extension a
 * teacher installs, so the client is made not to depend on it:
 *
 *   1. readJson turns an unreadable body into a thrown Error, never garbage on
 *      screen.
 *   2. If the reply can't be read, the bytes may still be stored -- the server
 *      logged the upload before it answered. Rather than fail (or re-upload,
 *      which would duplicate the row), look the file up by the hash of its own
 *      content and carry on with the record that already exists.
 *
 * The charge is keyed on the same content hash server-side, so recovering an
 * existing upload -- or a re-upload of identical bytes -- never charges twice.
 */
export async function uploadFile(file: File): Promise<UploadResult> {
  const bytes = await file.arrayBuffer();
  const form = new FormData();
  form.append("file", file);
  const r = await fetch("/api/uploads", { method: "POST", body: form });
  let d: unknown;
  try {
    d = await readJson(r);
  } catch (unreadable) {
    // The reply was lost in transit. The file may already be stored; find it by
    // its content before giving up.
    const recovered = await recoverUpload(bytes);
    if (recovered) return recovered;
    throw unreadable;
  }
  if (!r.ok) throw new Error((d as { error?: string })?.error || "Upload failed. Please try again.");
  return d as UploadResult;
}

/**
 * Finds an already-stored upload of these exact bytes for the signed-in
 * teacher, or null if there is none (including on the Sites host, which does
 * not hash uploads). Never throws: recovery is best effort, and a failure here
 * just means the original error stands.
 */
async function recoverUpload(bytes: ArrayBuffer): Promise<UploadResult | null> {
  try {
    const sha256 = await contentHash(bytes);
    const r = await fetch("/api/uploads?sha256=" + sha256, { cache: "no-store" });
    if (!r.ok) return null;
    const d = (await readJson(r)) as UploadResult;
    return d && typeof d.id === "string" ? d : null;
  } catch {
    return null;
  }
}
