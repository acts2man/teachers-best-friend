import "server-only";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "./supabase-admin";
import { owner, HttpError } from "@/lib/teacher-server";

/**
 * ONE INTEGRATION POINT.
 * Replace the body of getSessionUserId() with the app's existing
 * server-side session lookup — the same helper app/api/analyze/route.ts
 * uses to identify the signed-in owner. It should return the auth user's
 * UUID, or null when nobody is signed in.
 */
async function getSessionUserId(): Promise<string | null> {
  // owner() is the app's server-side session lookup (lib/teacher-server.ts),
  // the same helper the API routes use to identify the signed-in teacher.
  // It throws an HttpError (401) when nobody is signed in.
  try {
    return await owner();
  } catch (error) {
    if (error instanceof HttpError) return null;
    throw error;
  }
}

export type AdminIdentity = { id: string; email: string };

/**
 * Call at the top of every admin page and server action.
 * Redirects non-admins away. The check is the database's is_admin()
 * function, so a user cannot become admin by editing their own profile —
 * the profiles trigger blocks self-writes to that column.
 */
export async function requireAdmin(): Promise<AdminIdentity> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login?next=/admin");

  const db = supabaseAdmin();
  const { data: ok, error } = await db.rpc("is_admin", { p_user: userId });
  if (error || !ok) redirect("/");

  const { data: u } = await db.auth.admin.getUserById(userId);
  return { id: userId, email: u?.user?.email ?? "" };
}

/**
 * The same gate as requireAdmin(), for API routes.
 *
 * requireAdmin() calls redirect(), which is right for a page load and wrong
 * for a fetch. redirect() throws NEXT_REDIRECT; a route handler's try/catch
 * catches it like any other error and apiError() maps an unrecognised throw to
 * a 503 "We couldn't complete that request." So a signed-out caller and a
 * teacher who is simply not an admin both got an outage message, and a run of
 * them in the logs would read as the site being down rather than as the gate
 * doing its job.
 *
 * Nothing leaks either way -- the throw happens before anything is read -- but
 * "you are not allowed" and "we are broken" are not interchangeable, least of
 * all in what an operator sees at three in the morning.
 *
 * Same shape as requireAppManagerId() below, which has always done this
 * correctly; this is the missing half of that pair, not a new idea.
 */
export async function requireAdminApi(): Promise<AdminIdentity> {
  const userId = await getSessionUserId();
  if (!userId) throw new HttpError(401, "Please sign in.");

  const db = supabaseAdmin();
  const { data: ok, error } = await db.rpc("is_admin", { p_user: userId });
  if (error || !ok)
    throw new HttpError(403, "That’s only available to administrators.");

  const { data: u } = await db.auth.admin.getUserById(userId);
  return { id: userId, email: u?.user?.email ?? "" };
}

/**
 * Call at the top of any page or action that starts/manages
 * impersonation. Requires admin or app-manager on an active account — the database
 * function re-checks can_impersonate() itself on every call, this is the redirect
 * for a nicer page-load experience.
 */
export async function requireAppManager(): Promise<AdminIdentity> {
  const admin = await requireAdmin();
  const db = supabaseAdmin();
  const { data: ok, error } = await db.rpc("can_impersonate", {
    p_user: admin.id,
  });
  if (error || !ok) redirect("/admin");
  return admin;
}

/**
 * The same gate as requireAppManager(), for API routes. Redirecting is the
 * right answer for a page load and the wrong one for a fetch — the browser
 * would follow it and hand the caller an HTML page where it expected JSON.
 * Throws an HttpError that apiError() renders as a normal JSON failure.
 */
export async function requireAppManagerId(): Promise<string> {
  const userId = await getSessionUserId();
  if (!userId) throw new HttpError(401, "Sign in first.");
  const { data: ok, error } = await supabaseAdmin().rpc("can_impersonate", {
    p_user: userId,
  });
  if (error || !ok)
    throw new HttpError(403, "Your account can’t view other accounts.");
  return userId;
}

/**
 * Non-redirecting check for conditionally showing app-manager-only UI
 * (the "View this account" button). The real gate is requireAppManager()
 * inside the server action itself — this is display-only.
 */
export async function currentIsAppManager(): Promise<boolean> {
  try {
    const userId = await getSessionUserId();
    if (!userId) return false;
    const { data, error } = await supabaseAdmin().rpc("can_impersonate", {
      p_user: userId,
    });
    return !error && Boolean(data);
  } catch {
    return false;
  }
}
