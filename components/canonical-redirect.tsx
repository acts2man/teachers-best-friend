"use client";

import { useEffect } from "react";
import { canonicalRedirectTarget } from "@/lib/canonical-host";

/**
 * On load, if the page is being served from a non-canonical host in
 * production, send the person to the same path on the real site.
 *
 * This is the half that rescues a bookmark. The server guard (proxy.ts) makes a
 * stale permalink's API and auth routes inert; this moves the human off it so
 * they land on the real site, signed-in state intact, and can re-save the
 * bookmark. It runs only when the shared rule (canonicalRedirectTarget →
 * hostGuardEnforced) says production and the host is wrong; on the canonical
 * host, on deploy previews, branch deploys and localhost it does nothing.
 *
 * Renders nothing. Mounted once at the root so it covers every page.
 */
export function CanonicalRedirect() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const target = canonicalRedirectTarget(window.location);
    if (target) window.location.replace(target);
  }, []);
  return null;
}
