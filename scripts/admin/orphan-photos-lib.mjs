// The comparison behind scripts/admin/orphan-photos.mjs, kept pure so it can be
// tested without a database. See that file for what it is for and its limits.

/** Restore window of 12 Oct 2026 (UTC): the backup point and the restore. */
export const LOST_WINDOW = { from: "2026-10-12T12:54:00Z", to: "2026-10-13T00:36:00Z" };

/** Which time range an object falls in, by when it was written. */
export function timeRange(createdAt, window = LOST_WINDOW) {
  const t = Date.parse(createdAt ?? "");
  if (!Number.isFinite(t)) return "unknown";
  if (t < Date.parse(window.from)) return "before the backup point";
  if (t < Date.parse(window.to)) return "lost window (12 Oct 05:54-17:36 PT)";
  return "after the restore";
}

/** A teacher id shortened for a printed report: enough to tell teachers apart. */
export const teacherOf = (path) => String(path).split("/")[0].slice(0, 8) || "(root)";

/**
 * Compares what the bucket holds with what teacher_uploads records.
 *   objects: [{ path, size, createdAt }] -- from the Storage API listing
 *   rows:    [{ object_path, purged_at }] -- every teacher_uploads row
 * Returns the files with no row at all (orphans: nothing will ever purge
 * them), the live rows whose file is missing, and counts of the orphans by
 * teacher and time range.
 */
export function compare(objects, rows, window = LOST_WINDOW) {
  const byPath = new Map(rows.map((r) => [r.object_path, r]));
  const inBucket = new Set(objects.map((o) => o.path));
  const orphans = objects.filter((o) => !byPath.has(o.path)).sort((a, b) => a.path.localeCompare(b.path));
  const missing = rows.filter((r) => !r.purged_at && !inBucket.has(r.object_path)).map((r) => r.object_path).sort();
  // A purged row whose file is still there: the 30-day job said it removed it.
  const purgedButPresent = objects.filter((o) => byPath.get(o.path)?.purged_at).map((o) => o.path).sort();
  const counts = {};
  for (const o of orphans) {
    const key = teacherOf(o.path) + " | " + timeRange(o.createdAt, window);
    counts[key] = counts[key] ?? { files: 0, bytes: 0 };
    counts[key].files++;
    counts[key].bytes += Number(o.size) || 0;
  }
  return { orphans, missing, purgedButPresent, counts };
}

/** A short fingerprint of a manifest, which the delete step must be given back:
 * it deletes exactly the set that was reviewed, never a re-listing. */
export async function manifestToken(paths) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update([...paths].sort().join("\n")).digest("hex").slice(0, 12);
}

/** The manifest paths that are STILL orphans now (a row may have appeared
 * since the report, e.g. an upload finishing): only these may be deleted. */
export function stillOrphaned(paths, rowsNow) {
  const known = new Set(rowsNow.map((r) => r.object_path));
  return { remove: paths.filter((p) => !known.has(p)), skipped: paths.filter((p) => known.has(p)) };
}
