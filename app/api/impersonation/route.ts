import { cookies } from "next/headers";
import {
  owner,
  apiError,
  guardOrigin,
  HttpError,
  IMPERSONATION_COOKIE,
} from "@/lib/teacher-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAppManagerId } from "@/lib/admin-gate";

/**
 * Starting a "view as" session from inside the teacher app.
 *
 * lib/impersonation-actions.ts already starts one as a server action, which
 * is fine from /admin because that route is force-dynamic. The teacher app's
 * own picker lives on /app and /[view], which are force-static — the same
 * prerender-cache problem documented on DELETE below would swallow the POST.
 * So the picker calls this route handler instead, which is never cached.
 */
export async function POST(request: Request) {
  try {
    guardOrigin(request);
    const actor = await requireAppManagerId();

    const jar = await cookies();
    // No nesting. Starting a second session from inside the first would strand
    // the older session open and make "stop viewing" ambiguous.
    if (jar.get(IMPERSONATION_COOKIE)?.value)
      throw new HttpError(
        409,
        "You’re already viewing an account. Stop viewing before starting another.",
      );

    const body = (await request.json().catch(() => null)) as {
      teacherId?: unknown;
    } | null;
    const teacherId = typeof body?.teacherId === "string" ? body.teacherId.trim() : "";
    if (!teacherId) throw new HttpError(400, "Choose an account to view.");

    const { data, error } = await supabaseAdmin().rpc("start_impersonation", {
      p_actor: actor,
      p_teacher: teacherId,
    });
    if (error) {
      // The database is the real gate and raises its own named errors.
      if (error.message.includes("CANNOT_IMPERSONATE_SELF"))
        throw new HttpError(400, "That is your own account.");
      if (error.message.includes("NOT_APP_MANAGER"))
        throw new HttpError(403, "Your account can’t view other accounts.");
      throw new HttpError(500, "The session couldn’t be started.");
    }

    jar.set(IMPERSONATION_COOKIE, data as string, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 30 * 60, // matches the session's own 30-minute expiry
    });
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

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
