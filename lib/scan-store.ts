/**
 * Offline safety net for the in-app camera: every captured page is written to
 * IndexedDB the moment it's taken, keyed by assessment and student group, so a
 * phone call, an app switch, or the tab unloading mid-class doesn't lose the
 * whole stack. When the camera reopens for the same assessment it offers to
 * restore the unsaved pages; they're cleared once Done hands them off.
 *
 * Every call is guarded and can never throw or block capture: if IndexedDB is
 * missing or refuses (private mode, quota, an old browser), reads return empty
 * and writes quietly no-op, and the camera falls back to holding pages in
 * memory exactly as before.
 */

export type StoredShot = {
  id: string;
  assessmentId: string;
  group: number;
  seq: number;
  blob: Blob;
  /** Handed to the scan panel at "Next student" and not yet landed there (a
   * landed page is deleted from this store). Saved, so a reload never offers
   * a page the panel already has (#182 review). */
  sent?: boolean;
  /** Handed over and failed after its retries (#188 review): kept, so a
   * reload never loses it. The scan screen's Retry holds it while the tab is
   * open; after a reload the camera offers it, and the scan screen holds
   * grading until it is restored or left out. */
  failed?: boolean;
  /** Where a failed page belongs, written by the scan screen when it fails:
   * its student's pile, its place there and its label, so after a reload its
   * Retry puts it back with the right student. */
  failedAt?: { pile: number; index: number; label: string };
  /** Where a page is going, written by the scan screen the moment it starts
   * uploading it (review of #188): a page still uploading when the tab
   * reloads is retried into that place. Absent on a page whose student was
   * still waiting in the upload queue -- it gets a pile of its own. */
  placeAt?: { pile: number; index: number; label: string };
};

/** What happened to one page handed over at "Next student". */
export type HandoffOutcome = "landed" | "failed" | "refused";

/**
 * What the camera does with its saved copies once the panel has answered for
 * the pages it handed over (Next student or Finished), so every page lives in
 * exactly one place (#182 review, 27 Oct):
 *   - landed: in its pile. (Its copy was deleted the moment it landed.)
 *   - failed after its retries: it waits with Retry on the scan screen, and
 *     its saved copy is kept, flagged "failed", so a reload never loses it.
 *     The two never both add it: the camera does not offer a page the scan
 *     screen's Retry holds, and a Retry that lands (or "Leave it out")
 *     deletes the copy.
 *   - refused (setup not ready, page limit): still the camera's. The saved
 *     copy is un-marked, so Finished or a reopened camera offers it again.
 *   - the queue itself failed ("rejected"): nothing more is known, so every
 *     page that had not landed goes back to the camera -- never one that had.
 * Pure, so it is unit-testable.
 */
export function settleHandoff(
  ids: string[],
  outcome: HandoffOutcome[] | "rejected",
  landed: ReadonlySet<string>,
): { markFailed: string[]; giveBack: string[] } {
  if (outcome === "rejected") return { markFailed: [], giveBack: ids.filter((id) => !landed.has(id)) };
  return {
    markFailed: ids.filter((_, i) => outcome[i] === "failed"),
    giveBack: ids.filter((id, i) => outcome[i] === "refused" && !landed.has(id)),
  };
}

/** The pages a reopened camera may offer back: the ones never handed over,
 * and handed-over pages that failed -- never one that landed or was still
 * uploading when the tab closed, and never one the scan screen's Retry holds
 * right now (`held`, by page id). Pure, so it is unit-testable. */
export function restorableShots(shots: StoredShot[], held: ReadonlySet<string> = new Set()): StoredShot[] {
  return orderStored(shots.filter((s) => (!s.sent || s.failed) && !held.has(s.id)));
}

/** The failed pages kept in the camera that the scan screen's Retry does not
 * hold -- after a reload, all of them. Grading waits on these too. */
export function failedShots(shots: StoredShot[], held: ReadonlySet<string> = new Set()): StoredShot[] {
  return orderStored(shots.filter((s) => s.failed && !held.has(s.id)));
}

/**
 * The pages the scan screen picks back up when it opens (review of #188):
 * every page handed over and not landed -- failed after its retries, or
 * still uploading when the tab reloaded (sent, not failed: a landed page's
 * copy is deleted the moment it lands, so a sent copy that is still here
 * never landed in a pile this tab kept). Not one the scan screen holds.
 */
export function pagesToPickUp(shots: StoredShot[], held: ReadonlySet<string> = new Set()): StoredShot[] {
  return orderStored(shots.filter((s) => s.sent && !held.has(s.id)));
}

const DB_NAME = "tbf-scan-camera";
const STORE = "shots";
const VERSION = 1;

/** Sort stored pages back into capture order. Pure, so it is unit-testable. */
export function orderStored(shots: StoredShot[]): StoredShot[] {
  return shots.slice().sort((a, b) => a.seq - b.seq);
}

function factory(): IDBFactory | null {
  try {
    return typeof indexedDB !== "undefined" ? indexedDB : null;
  } catch {
    return null;
  }
}

function open(): Promise<IDBDatabase | null> {
  const idb = factory();
  if (!idb) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = idb.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: "id" });
          os.createIndex("assessmentId", "assessmentId", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Persist (or overwrite) one captured page. Never throws. */
export async function saveShot(shot: StoredShot): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(shot);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  try {
    db.close();
  } catch {
    /* ignore */
  }
}

/** Forget one page (the teacher deleted its thumbnail). Never throws. */
export async function deleteShot(id: string): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  try {
    db.close();
  } catch {
    /* ignore */
  }
}

/** The unsaved pages held for an assessment, in capture order. [] on any failure. */
/** Flags a handed-over page as failed after its retries, with where it
 * belongs (the scan screen calls this; see StoredShot.failedAt). */
export async function markShotFailed(id: string, at: { pile: number; index: number; label: string }): Promise<void> {
  return patchShot(id, { sent: true, failed: true, failedAt: at });
}

/** Records where a page is going as its upload starts (StoredShot.placeAt). */
export async function markShotPlace(id: string, at: { pile: number; index: number; label: string }): Promise<void> {
  return patchShot(id, { placeAt: at });
}

async function patchShot(id: string, patch: Partial<StoredShot>): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const os = tx.objectStore(STORE);
      const req = os.get(id);
      req.onsuccess = () => {
        if (req.result) os.put({ ...req.result, ...patch });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function loadShots(assessmentId: string): Promise<StoredShot[]> {
  const db = await open();
  if (!db) return [];
  const result = await new Promise<StoredShot[]>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).index("assessmentId").getAll(assessmentId);
      req.onsuccess = () => resolve((req.result as StoredShot[]) ?? []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
  try {
    db.close();
  } catch {
    /* ignore */
  }
  return orderStored(result);
}

/** Drop every stored page for an assessment (after Done, or an explicit discard). */
export async function clearShots(assessmentId: string): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const req = tx.objectStore(STORE).index("assessmentId").openCursor(IDBKeyRange.only(assessmentId));
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  try {
    db.close();
  } catch {
    /* ignore */
  }
}
