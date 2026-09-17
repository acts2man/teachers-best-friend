import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { owner, IMPERSONATION_COOKIE } from "@/lib/teacher-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

/**
 * The escape hatch: a plain URL an app manager can type to get out of a
 * "view as" session that will not close any other way.
 *
 * "Stop viewing" is a button that runs a fetch, so it depends on the banner
 * rendering, on JavaScript running, and on that request landing. Each of
 * those has failed at least once here -- the banner exit was silently served
 * from the prerender cache until it was moved to a route handler. Being
 * stuck inside another person's account with no way out is the worst failure
 * this feature has, so it gets a recovery path that needs nothing but the
 * address bar.
 *
 * A GET that changes something is normally the wrong shape, and it is the
 * right one here: the only thing it can do to a victim of a forged request
 * is return them to their own account, which is where they are supposed to
 * be. It never starts a session and never chooses a target.
 */
export async function GET() {
  const jar = await cookies();
  const session = jar.get(IMPERSONATION_COOKIE)?.value;

  // Clear first and unconditionally. Closing the row in the database is
  // bookkeeping; getting the person out is the part that must not fail.
  jar.delete(IMPERSONATION_COOKIE);

  if (session) {
    try {
      const actor = await owner();
      await supabaseAdmin().rpc("stop_impersonation", {
        p_session: session,
        p_actor: actor,
      });
    } catch {
      // The cookie is already gone, so they are out either way, and the row
      // expires on its own within 30 minutes.
    }
  }
  redirect("/app");
}
