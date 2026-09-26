/**
 * Identifies a file by its content rather than its upload row.
 *
 * The same bytes always hash to the same string, on the server (where it stops
 * a page being charged twice) and in the browser (where it lets a client find
 * the upload its own file produced when the reply that would have named it was
 * lost). Both sides MUST agree byte for byte, so the one implementation lives
 * here, in a module with no server-only dependencies, and is imported by both.
 *
 * Content, not the upload row: the class-scan flow uploads every photograph
 * twice (body crop and name strip are separate rows), a teacher can upload the
 * same file twice, and an upload row is deleted well before the charge stops
 * mattering -- none of those are the same page arriving twice, and all would
 * look like it if the upload id were the identity.
 */
export async function contentHash(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
