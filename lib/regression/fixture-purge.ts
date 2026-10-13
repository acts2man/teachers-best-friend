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
  const { data: fixtures, error: fixturesError } = await svc
    .from("regression_fixtures")
    .select("object_path")
    .eq("teacher_id", teacherId);
  // Before the regression migration is applied the table does not exist; that
  // is "no fixtures", not a failed deletion.
  if (fixturesError && !/does not exist|schema cache/i.test(fixturesError.message)) throw fixturesError;
  const paths = (fixtures ?? []).map((r) => r.object_path as string).filter(Boolean);
  if (paths.length) {
    const { error } = await svc.storage.from(FIXTURE_BUCKET).remove(paths);
    // A file already gone is fine: the point is to end up with none.
    if (error && !/not found/i.test(error.message)) throw error;
  }
  if (revokeConsent) {
    const { error } = await svc.from("regression_fixture_allowlist").delete().eq("teacher_id", teacherId);
    if (error && !/does not exist|schema cache/i.test(error.message)) throw error;
  }
  return paths.length;
}
