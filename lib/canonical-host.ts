/**
 * The app refuses to run anywhere but its real address.
 *
 * Why this exists: a Netlify deploy permalink -- e.g.
 * https://<deploy-id>--teachersbestfriend.netlify.app -- is a complete,
 * permanently reachable copy of a production build. It carries the whole
 * production environment, SUPABASE_SERVICE_ROLE_KEY included, and it is
 * same-origin with itself, so every CSRF/origin check inside it passes. A
 * pilot teacher used one of those permalinks for nine days; scans ran against
 * the production database while every internal signal looked fine.
 *
 * The hole was guardOrigin() trusting the request's own forwarded host. The
 * fix is a single canonical host, read from the environment, that every
 * production request is measured against. A permalink of a production deploy
 * still reports CONTEXT=production (it is the same build), so context alone
 * cannot tell it apart from the real site -- the HOST is the discriminator.
 *
 * Honest limit: this protects every deploy BUILT FROM NOW ON, because a build
 * has to carry this code to enforce it. It can never appear inside a permalink
 * that already exists. That is why deleting old deploys and limiting Netlify's
 * deploy retention still matter; this guard contains new permalinks, it does
 * not reach back into old ones.
 *
 * Isomorphic on purpose: proxy.ts (server), guardOrigin() (server) and the
 * on-load client redirect all decide with the same rule, from the same two
 * environment values. Both are inlined into the client bundle by
 * next.config.ts, so process.env reads them in the browser too. No
 * "server-only" import here.
 */

/** The one address the app is allowed to serve from, e.g.
 * "teachersbestfriend.netlify.app". Bare host, no scheme, no path. Empty when
 * unset. Documented in .env.example as CANONICAL_HOST. */
export function canonicalHost(): string {
  return normalizeHost(process.env.CANONICAL_HOST);
}

/** Netlify's build context: "production", "deploy-preview", "branch-deploy",
 * or "dev". Empty on a plain local build. Inlined by next.config.ts. */
export function deployContext(): string {
  return (process.env.CONTEXT ?? "").trim().toLowerCase();
}

/**
 * Only real production is host-locked.
 *
 * "deploy-preview" (PR previews) and "branch-deploy" (branch checks) have
 * generated hostnames that are legitimately not canonical -- they are how the
 * deploy-preview and branch checks reach the app at all -- and "dev"/empty is
 * a developer's machine or localhost. Locking any of those would break exactly
 * the things Part 1 must not break. Locking production is the whole point: a
 * production build served from a non-canonical host is a permalink.
 */
export function hostGuardEnforced(context: string = deployContext()): boolean {
  return context === "production";
}

/** Lowercase, trimmed, with any :port stripped so a host compares by name. */
function normalizeHost(host: string | null | undefined): string {
  return (host ?? "").trim().toLowerCase().replace(/:\d+$/, "");
}

export function isCanonicalHost(
  host: string | null | undefined,
  canonical: string = canonicalHost(),
): boolean {
  if (!canonical) return false;
  return normalizeHost(host) === normalizeHost(canonical);
}

/**
 * The server-side decision, in one place.
 *
 * Returns a teacher-readable refusal string when a request's host must be
 * refused, or null to let it through. Reads are refused as well as writes (see
 * proxy.ts for the argument): a stale permalink that still served reads would
 * still be "fully usable", which is exactly the nine-day failure this closes.
 *
 * Unset canonical value: in production we fail loud rather than silently allow
 * everything. A production build with no CANONICAL_HOST cannot prove it is at
 * its real address, so it refuses -- Troy's stated preference, and the safe
 * one: a loud outage is fixed in minutes, a silent allow-everything is how a
 * permalink goes unnoticed for nine days. Outside production the value is
 * expected to be unset, so there we stand down.
 */
export function hostRefusal(
  host: string | null | undefined,
  opts: { context?: string; canonical?: string } = {},
): string | null {
  const context = opts.context ?? deployContext();
  if (!hostGuardEnforced(context)) return null; // previews, branch deploys, dev
  const canonical = opts.canonical ?? canonicalHost();
  if (!canonical)
    return "A Teacher’s Best Friend is temporarily unavailable (the site address isn’t configured). Please try again shortly or contact support.";
  if (isCanonicalHost(host, canonical)) return null;
  return `A Teacher’s Best Friend runs at https://${canonical}. This copy at ${
    normalizeHost(host) || "this address"
  } is an old preview and can no longer be used — please go to https://${canonical} and update your bookmark.`;
}

/** The address the client should redirect to on load, or null to stay put.
 * Same rule as hostRefusal, but a bad host on a real page is rescued by moving
 * the person to the canonical site (keeping their path) rather than showing an
 * error -- that is what saves a bookmark. */
export function canonicalRedirectTarget(
  location: { host: string; pathname: string; search: string; hash: string },
): string | null {
  if (!hostGuardEnforced()) return null;
  const canonical = canonicalHost();
  if (!canonical) return null; // nothing to redirect to; the server fails loud
  if (isCanonicalHost(location.host, canonical)) return null;
  return `https://${canonical}${location.pathname}${location.search}${location.hash}`;
}
