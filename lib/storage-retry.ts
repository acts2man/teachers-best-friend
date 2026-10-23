/**
 * Writing one uploaded file to storage, tried again when storage hiccups.
 *
 * On 20 Oct a 72-page class scan stopped twice because one storage write came
 * back 520 (04:02Z and 04:19Z) and saveDocument threw on the first error. A
 * 5xx from storage, or a write that never got an answer, is now tried up to
 * STORAGE_TRIES times with a short wait. Anything else (a 4xx: the bucket
 * refused the file) fails at once.
 *
 * A retry writes to the same object path, which is a fresh random id per
 * upload. So if an earlier try did store the object and only the answer was
 * lost, storage now says the object already exists (upsert is off) -- and that
 * is success, not a failure: the bytes are there, under the path this upload
 * owns. No second object and no second row (the row is inserted once, after
 * the write succeeds).
 */
export const STORAGE_TRIES = 3;
export const STORAGE_BACKOFF_MS = [300, 900];

type StorageWriteError = { status?: unknown; statusCode?: unknown; message?: unknown } | null | undefined;

/** A storage error worth another try: a 5xx, or no HTTP status at all (the
 * request never got an answer -- a dropped connection or a timeout). */
export function isTransientStorageError(error: StorageWriteError): boolean {
  if (!error) return false;
  const status = Number(error.status ?? error.statusCode);
  return !Number.isFinite(status) || status >= 500;
}

/** Storage saying the object is already there. */
export function isAlreadyStored(error: StorageWriteError): boolean {
  if (!error) return false;
  // Supabase Storage has answered a duplicate both as HTTP 409 and as HTTP
  // 400 with statusCode "409" and "The resource already exists".
  return (
    Number(error.status) === 409 ||
    String(error.statusCode) === "409" ||
    /already exists|duplicate/i.test(String(error.message ?? ""))
  );
}

/**
 * Runs `write` until it succeeds, retrying transient failures. Returns how
 * many tries it took; throws the last error when it gives up.
 */
export async function writeWithRetry(
  write: () => Promise<{ error: StorageWriteError }>,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<number> {
  let last: StorageWriteError = null;
  for (let attempt = 1; attempt <= STORAGE_TRIES; attempt++) {
    if (attempt > 1) await sleep(STORAGE_BACKOFF_MS[attempt - 2] ?? 0);
    let error: StorageWriteError;
    try {
      ({ error } = await write());
    } catch (thrown) {
      // A client that throws instead of returning an error: treat it as a
      // write that got no answer.
      error = { message: thrown instanceof Error ? thrown.message : String(thrown) };
    }
    if (!error) return attempt;
    // An earlier try stored it and lost the answer.
    if (attempt > 1 && isAlreadyStored(error)) return attempt;
    last = error;
    if (!isTransientStorageError(error)) break;
  }
  throw last;
}
