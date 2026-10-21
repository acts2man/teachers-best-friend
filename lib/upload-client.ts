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
 *   3. A reply that failed with a 5xx (a storage 520, a function that fell
 *      over) or a connection that dropped is tried again, up to UPLOAD_TRIES
 *      times with a short wait, looking the file up by its content before each
 *      retry -- so a retry never makes a second row.
 *
 * The charge is keyed on the same content hash server-side, so recovering an
 * existing upload -- or a re-upload of identical bytes -- never charges twice.
 */
export async function uploadFile(
  file: File,
  options: UploadOptions = {},
): Promise<UploadResult> {
  const sleep = options.sleep ?? wait;
  const bytes = await file.arrayBuffer();
  let last: unknown = new Error("Upload failed. Please try again.");
  for (let attempt = 1; attempt <= UPLOAD_TRIES; attempt++) {
    // Before a retry -- or before a teacher's own "Retry" of a page that
    // failed earlier -- look the file up by its content first. A failed reply
    // does not mean nothing was stored: the server may have saved the row and
    // then lost the answer. Re-posting would add a second row; finding it adds
    // nothing and charges nothing (the charge is keyed on the same hash).
    if (attempt > 1) await sleep(UPLOAD_BACKOFF_MS[attempt - 2] ?? 0);
    if (attempt > 1 || options.recoverFirst) {
      const recovered = await recoverUpload(bytes);
      if (recovered) return recovered;
    }
    const form = new FormData();
    form.append("file", file);
    let r: Response;
    try {
      r = await fetch("/api/uploads", { method: "POST", body: form });
    } catch (network) {
      // The connection dropped: worth another try.
      last = network;
      continue;
    }
    let d: unknown;
    try {
      d = await readJson(r);
    } catch (unreadable) {
      // The reply was lost in transit. The file may already be stored; the
      // next try looks for it by content before posting again. An unreadable
      // 4xx is still the request's fault: look once, then stop, as before.
      last = unreadable;
      if (r.status >= 400 && r.status < 500) {
        const found = await recoverUpload(bytes);
        if (found) return found;
        throw unreadable;
      }
      continue;
    }
    if (r.ok) return d as UploadResult;
    last = new Error((d as { error?: string })?.error || "Upload failed. Please try again.");
    // A 4xx is the file or the request (too big, wrong type, signed out):
    // sending it again cannot help. Only a server or storage hiccup -- 5xx,
    // like the storage 520s that stopped a 72-page class scan twice on 20 Oct
    // -- is retried.
    if (r.status < 500) throw last;
  }
  // One last look: the final try may have stored it before failing.
  const recovered = await recoverUpload(bytes);
  if (recovered) return recovered;
  // Said plainly: the raw error of a storage 520 is an HTML page or a JSON
  // parse message, neither of which tells a teacher anything.
  throw new Error(
    "This page didn't upload after " + UPLOAD_TRIES + " tries. Check the connection and try again.",
    { cause: last },
  );
}

/** How many times one upload is tried before it is reported as failed. */
export const UPLOAD_TRIES = 3;
/** The wait before the 2nd and the 3rd try. Short: a storage hiccup clears in
 * a moment, and a teacher is watching the page count. */
export const UPLOAD_BACKOFF_MS = [600, 1800];

export type UploadOptions = {
  /** Look the file up by content before the first post as well: for a page
   * the teacher retries by hand after it failed. */
  recoverFirst?: boolean;
  /** For tests: how to wait between tries. */
  sleep?: (ms: number) => Promise<void>;
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
