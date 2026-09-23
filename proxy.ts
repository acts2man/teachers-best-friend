import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { hostRefusal } from "@/lib/canonical-host";

export async function proxy(request: NextRequest) {
  // Before anything else: is this request even at the app's real address?
  //
  // This matcher already covers /api/* and /auth/* -- everything with server
  // behaviour and a session. A production build served from a non-canonical
  // host (a Netlify deploy permalink) is refused here, before updateSession
  // touches the Supabase cookies with the production service context.
  //
  // Reads are refused as well as writes. The prompt asks writes be refused;
  // reads are refused too, and deliberately: the nine-day incident was a stale
  // permalink where GET /login returned 200 and the app was "fully usable".
  // Refusing only writes would leave that copy browsable and signed into, which
  // is most of the harm. Blocking all of /api and /auth makes the copy inert;
  // the client-side redirect then moves a real person to the canonical site.
  // Deploy previews, branch deploys and localhost are untouched -- hostRefusal
  // only enforces when CONTEXT is "production".
  const forwardedHost =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const refusal = hostRefusal(forwardedHost);
  if (refusal)
    return NextResponse.json(
      { error: refusal },
      // 421 Misdirected Request is exactly this case: the server was reached at
      // an address it will not answer for. The teacher app reads { error } from
      // the body regardless of status.
      { status: 421, headers: { "cache-control": "no-store" } },
    );

  return updateSession(request);
}

// The app's screens are static pages that never read the session on the
// server, so the Supabase session refresh only needs to run where the session
// is actually used: the API routes and the auth callbacks. Keeping it off page
// navigation removes a network round trip from every screen switch.
//
// The canonical-host guard above rides on this same matcher on purpose: it is
// where credentialed server work happens. Page navigations are left to the
// client-side redirect (components/canonical-redirect.tsx), which is what
// rescues a bookmarked page.
export const config = {
  matcher: ["/api/:path*", "/auth/:path*"],
};
