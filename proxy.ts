import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

// The app's screens are static pages that never read the session on the
// server, so the Supabase session refresh only needs to run where the session
// is actually used: the API routes and the auth callbacks. Keeping it off page
// navigation removes a network round trip from every screen switch.
export const config = {
  matcher: ["/api/:path*", "/auth/:path*"],
};
