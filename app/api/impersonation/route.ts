import { cookies } from "next/headers";
import {
  owner,
  apiError,
  guardOrigin,
  IMPERSONATION_COOKIE,
} from "@/lib/teacher-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Ending a "view as" session.
 *
 * This used to be a server action on the teacher app's banner. That banner
 * renders on /app and /[view], which are `force-static` — the action POST was
 * answered out of the prerender cache (`x-nextjs-cache: HIT`,
 * `s-maxage=31536000`), so the cookie deletion and the redirect were not
 * reliably applied and the app manager was left stranded inside the teacher's
 * account with an error page. startImpersonation never hit this because it
 * runs from /admin, which is force-dynamic.
 *
 * A route handler is always dynamic and never cached, so the exit works from
 * wherever the banner happens to be rendered.
 */
export async function DELETE(request: Request) {
  const jar = await cookies();
  const session = jar.get(IMPERSONATION_COOKIE)?.value;
  try {
    guardOrigin(request);
    // Clear the cookie FIRST and unconditionally. Ending the session in the
    // database is bookkeeping; getting the app manager back into their own
    // account is the part that must not be able to fail. A stuck cookie means
    // a locked-out admin, which is exactly the bug this route replaces.
    jar.delete(IMPERSONATION_COOKIE);

    if (session) {
      // The real signed-in identity, never the teacher being viewed --
      // owner() reads the auth session and is not impersonation-aware.
      const actor = await owner();
      const { error } = await supabaseAdmin().rpc("stop_impersonation", {
        p_session: session,
        p_actor: actor,
      });
      // A failure here leaves a row that expires on its own within 30
      // minutes. The cookie is already gone, so the admin is out either way.
      if (error) console.error("stop_impersonation failed", error.message);
    }
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    jar.delete(IMPERSONATION_COOKIE);
    return apiError(error);
  }
}
