import { NextResponse } from "next/server";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/server";
import { guardOrigin, apiError, siteUrl } from "@/lib/teacher-server";

export async function POST(request: Request) {
  try {
    // Was outside the try: a cross-origin POST threw an unhandled HttpError
    // and answered with a 500 and a stack instead of a clean 403.
    guardOrigin(request);
    if (hasSupabaseConfig()) {
      const supabase = await createClient();
      await supabase.auth.signOut();
    }
    // Behind Netlify's proxy request.url is an internal address, so resolving
    // the redirect against it can send the teacher to a host they cannot
    // reach. Rebuild the public origin from the forwarded headers, the same
    // way guardOrigin does.
    return NextResponse.redirect(siteUrl(request, "/login"), 303);
  } catch (error) {
    return apiError(error);
  }
}
