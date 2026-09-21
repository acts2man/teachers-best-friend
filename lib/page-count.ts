import "server-only";
import { HttpError } from "@/lib/http-error";

/**
 * How many pages a teacher is charged for an upload, and what identifies it.
 *
 * Both answers are worked out here, on the server, from the bytes themselves.
 * The browser is never asked: page count is money now, and a number the client
 * sends is a number the client can choose. A ten-page PDF that reported itself
 * as one page would be nine free pages, every time, for anyone who noticed.
 */

/** Charging stops here. A stack this size is a mistake, not a class set. */
export const MAX_PAGES_PER_UPLOAD = 200;

/**
 * Identifies a page by its content rather than its upload row.
 *
 * The class-scan flow uploads every photograph twice -- the body crop and the
 * name strip are separate rows -- a teacher can upload the same file twice,
 * and an upload row is deleted well before the charge stops mattering. None of
 * those are the same page arriving twice, and all of them would look like it if
 * the upload id were the identity.
 */
export async function contentHash(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Pages in an upload. Images are one page; a PDF is parsed.
 *
 * A PDF that will not parse is rejected rather than guessed at. Guessing has
 * one of two outcomes and both are bad: guess low and the pages are free, guess
 * high and a teacher is billed for pages that were never there. "This file
 * couldn't be read" is a thing a teacher can act on.
 */
export async function countPages(mime: string, bytes: ArrayBuffer): Promise<number> {
  if (mime !== "application/pdf") return 1;
  let numPages: number;
  try {
    // The legacy build is the one that runs outside a browser. System fonts
    // are off because nothing here renders anything -- the page count is read
    // from the document catalog and the file is dropped.
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: false,
    }).promise;
    numPages = doc.numPages;
    await doc.cleanup?.();
  } catch {
    throw new HttpError(
      400,
      "This PDF couldn’t be read. Try exporting it again, or photograph the pages instead.",
    );
  }
  if (!Number.isInteger(numPages) || numPages < 1)
    throw new HttpError(
      400,
      "This PDF couldn’t be read. Try exporting it again, or photograph the pages instead.",
    );
  if (numPages > MAX_PAGES_PER_UPLOAD)
    throw new HttpError(
      413,
      `This PDF is ${numPages} pages. Split it into files of ${MAX_PAGES_PER_UPLOAD} pages or fewer.`,
    );
  return numPages;
}
