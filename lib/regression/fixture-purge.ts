import "server-only";
import type { createServiceClient } from "@/lib/supabase/service";

type ServiceClient = ReturnType<typeof createServiceClient>;

export const FIXTURE_BUCKET = "regression-fixtures";

/**
 * Removes every regression-fixture copy of a teacher's photos: the files in the
 * private bucket, and -- when `revokeConsent` -- the allow-list rows that held
 * the teacher's agreement, which takes the fixture rows and test cases with
 * them (ON DELETE CASCADE).
 *
 * Shared by the two ways a teacher's documents are deleted, so they cannot
 * drift apart again: full account deletion (files only; the account's rows go
 * by cascade in delete_teacher_account) and the teacher's own "delete my
 * workspace data" button, which used to leave these copies behind (#124
 * review). Service role on purpose: the fixtures are private, the teacher's
 * own session can neither see nor remove them.
 *
 * Returns how many files were removed.
 */
export async function removeTeacherFixtures(
  svc: ServiceClient,
  teacherId: string,
  { revokeConsent }: { revokeConsent: boolean },
): Promise<number> {
  const paths = new Set<string>();
  // Every row, a page at a time: one select stops at 1,000 rows (#124 review).
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await svc
      .from("regression_fixtures")
      .select("object_path")
      .eq("teacher_id", teacherId)
      .order("object_path")
      .range(from, from + PAGE - 1);
    // Before the regression migration is applied the table does not exist;
    // that is "no fixtures", not a failed deletion.
    if (error && !/does not exist|schema cache/i.test(error.message)) throw error;
    for (const r of data ?? []) if (r.object_path) paths.add(r.object_path as string);
    if (!data || data.length < PAGE) break;
  }
  // The agreement goes before the files (#128 round-3 review): a fixture copy
  // being made while this runs could otherwise land after the files were
  // removed and before the agreement was, and outlive "delete my data". With
  // the agreement gone first, no new copy can be made, and the folder listing
  // below still finds every file whose row the revocation cascaded away.
  if (revokeConsent) {
    const { error } = await svc.from("regression_fixture_allowlist").delete().eq("teacher_id", teacherId);
    if (error && !/does not exist|schema cache/i.test(error.message)) throw error;
  }
  // And whatever is in the teacher's folder of the bucket -- a copy whose row
  // was never written (the upload succeeded, the insert did not) is found
  // only this way. Every fixture lives at <teacher>/<assessment>/<upload>.
  for (const folder of await listNames(svc, teacherId))
    for (const file of await listNames(svc, `${teacherId}/${folder}`)) paths.add(`${teacherId}/${folder}/${file}`);
  const all = [...paths];
  for (let i = 0; i < all.length; i += REMOVE_CHUNK) {
    const { error } = await svc.storage.from(FIXTURE_BUCKET).remove(all.slice(i, i + REMOVE_CHUNK));
    // A file already gone is fine: the point is to end up with none.
    if (error && !/not found/i.test(error.message)) throw error;
  }
  return all.length;
}

const PAGE = 1000;
/** Files per Storage remove call; kept well under the API's per-call limit. */
const REMOVE_CHUNK = 500;

/** The names directly under `prefix` in the fixtures bucket, every page. */
async function listNames(svc: ServiceClient, prefix: string): Promise<string[]> {
  const names: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await svc.storage.from(FIXTURE_BUCKET).list(prefix, { limit: PAGE, offset });
    if (error) {
      if (/not found/i.test(error.message)) return names;
      throw error;
    }
    for (const item of data ?? []) if (item.name && item.name !== ".emptyFolderPlaceholder") names.push(item.name);
    if (!data || data.length < PAGE) return names;
  }
}
