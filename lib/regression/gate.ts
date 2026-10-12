import "server-only";
/**
 * Who may open the replay page or call its route: an account on the
 * regression_admins allow-list that is also an active admin
 * (is_regression_admin in the 20261012190000 migration). Everyone else -- signed
 * out, a teacher, an admin who is not on the list -- gets a 404, the same as a
 * page that does not exist, so the route does not even confirm it is there.
 */
import { notFound } from "next/navigation";
import { HttpError, owner } from "@/lib/teacher-server";
import { createServiceClient } from "@/lib/supabase/service";

/** Pure decision, separated so it can be tested without a session or database. */
export async function regressionAccess(
  sessionUser: () => Promise<string | null>,
  isRegressionAdmin: (id: string) => Promise<boolean>,
): Promise<string | null> {
  let id: string | null = null;
  try {
    id = await sessionUser();
  } catch {
    return null;
  }
  if (!id) return null;
  try {
    return (await isRegressionAdmin(id)) ? id : null;
  } catch {
    return null;
  }
}

async function sessionUser() {
  try {
    return await owner();
  } catch (e) {
    if (e instanceof HttpError) return null;
    throw e;
  }
}

async function checkAllowList(id: string) {
  const { data, error } = await createServiceClient().rpc("is_regression_admin", { p_user: id });
  if (error) throw error;
  return data === true;
}

/** For the page: the admin's id, or a 404. */
export async function requireRegressionAdmin(): Promise<string> {
  const id = await regressionAccess(sessionUser, checkAllowList);
  if (!id) notFound();
  return id;
}

/** For the route: the admin's id, or an HttpError(404) the route returns as is. */
export async function requireRegressionAdminApi(): Promise<string> {
  const id = await regressionAccess(sessionUser, checkAllowList);
  if (!id) throw new HttpError(404, "Not found.");
  return id;
}
