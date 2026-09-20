/**
 * Which build this code came from.
 *
 * One exported constant, read by everything that reports a build, so the
 * question "is the deployed app the one I merged" has a single answer rather
 * than several that can disagree by accident.
 *
 * It exists because they did disagree. /api/version reported real commits all
 * day -- the deploy check reads it and has confirmed twenty deploys -- while
 * every scan wrote a null build stamp, including scans whose neighbouring
 * column in the very same UPDATE was written correctly. Both read
 * process.env.COMMIT_REF, which next.config.ts inlines at build time, so either
 * the two functions were built from different sources or one of those two
 * inlinings did not happen. Sharing the constant removes the second
 * possibility, which leaves the first, which is the thing worth knowing.
 *
 * Empty rather than null when unset, so a local build is distinguishable from
 * a deployed one that failed to record itself.
 */
export const BUILD_REF = process.env.COMMIT_REF || "";

/** What to store on a row that records which build touched it. Null rather
 * than an empty string, because "not recorded" is a fact about the row and
 * belongs in the database as one. */
export function buildStamp(): string | null {
  return BUILD_REF || null;
}
