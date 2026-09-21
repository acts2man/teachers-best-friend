import { createClient, hasSupabaseConfig } from "@/lib/supabase/server";
import {
  guardOrigin,
  apiError,
  HttpError,
  writingTeacherId,
} from "@/lib/teacher-server";
import { emailsMatch, DeletionRefused } from "@/lib/account-deletion";
import {
  accountEmail,
  deleteTeacherAccount,
} from "@/lib/account-deletion-server";

/**
 * Delete my account.
 *
 * A teacher can only ever delete themselves: the id comes from
 * writingTeacherId(), never from the request body, so there is no id to
 * tamper with. writingTeacherId() also refuses outright while an admin is
 * "viewing as" someone -- a view-as session is read-only by design, and the
 * single most destructive action in the product is not the place to make an
 * exception. An admin with a real reason has their own door, on the account
 * page, which is audited under their own id.
 *
 * The work itself is in lib/account-deletion.ts, which owns the order, and
 * lib/account-deletion-server.ts, which does it. This route is the gate:
 * same origin, signed in, not impersonating, and the email typed out.
 */
export async function POST(request: Request) {
  try {
    guardOrigin(request);
    if (!hasSupabaseConfig())
      throw new HttpError(404, "Account deletion isn’t available here.");

    const teacherId = await writingTeacherId();

    const body = (await request.json().catch(() => ({}))) as {
      email?: unknown;
    };
    const typed = typeof body.email === "string" ? body.email : "";
    const actual = await accountEmail(teacherId);
    if (!emailsMatch(typed, actual))
      throw new HttpError(
        400,
        "That doesn’t match the email address on this account, so nothing has been deleted.",
      );

    const report = await deleteTeacherAccount(teacherId, { actorId: null });

    // Their session outlived their account by a few milliseconds. Clearing it
    // here rather than leaving it to the browser means the next request from
    // this tab is anonymous, not a token for a user that no longer exists.
    try {
      const supabase = await createClient();
      await supabase.auth.signOut();
    } catch {
      // The account is already gone; a failure to tidy the cookie is not
      // something to report as a failed deletion.
    }

    return Response.json({
      ok: true,
      redirect: "/?deleted=1",
      scansUnlinked: report.scansUnlinked,
    });
  } catch (error) {
    // A refusal is a deliberate stop with nothing deleted, and it carries the
    // sentence the teacher should read.
    if (error instanceof DeletionRefused) {
      console.error("Account deletion refused", error.detail);
      return Response.json({ error: error.message }, { status: error.status });
    }
    return apiError(error);
  }
}
