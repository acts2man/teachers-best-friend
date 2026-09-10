import "server-only";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "./supabase-admin";

/**
 * ONE INTEGRATION POINT.
 * Replace the body of getSessionUserId() with the app's existing
 * server-side session lookup — the same helper app/api/analyze/route.ts
 * uses to identify the signed-in owner. It should return the auth user's
 * UUID, or null when nobody is signed in.
 */
async function getSessionUserId(): Promise<string | null> {
  // TODO(integration): wire to lib/teacher-server.ts session helper.
  // Example if using @supabase/ssr:
  //   const supabase = createServerClient(...cookies...);
  //   const { data } = await supabase.auth.getUser();
  //   return data.user?.id ?? null;
  throw new Error("admin-gate: getSessionUserId() is not wired to the app's session helper yet");
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
