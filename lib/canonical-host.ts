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
 * fix is a canonical host, read from the environment, that every production
 * request is measured against. A permalink of a production deploy still
 * reports CONTEXT=production (it is the same build), so context alone cannot
 * tell it apart from the real site -- the HOST is the discriminator.
 *
 * Honest limit: this protects every deploy BUILT FROM NOW ON, because a build
 * has to carry this code to enforce it. It can never appear inside a permalink
 * that already exists. That is why deleting old deploys and limiting Netlify's
 * deploy retention still matter; this guard contains new permalinks, it does
 * not reach back into old ones.
 *
 * CANONICAL_HOST is a comma-separated list (usually one entry). The FIRST entry
 * is canonical -- the redirect target and the address error messages name --
 * and every entry is allowed. One entry behaves exactly as a single host did.
 * Two exist only during a domain switchover (the .com is coming): both the new
 * domain and the netlify.app are live while sessions, bookmarks and the
 * Supabase redirect list move over at their own pace, so both must be accepted
 * and the new domain (listed first) is where a stale bookmark is sent.
 *
 * Isomorphic on purpose: proxy.ts (server), guardOrigin() (server) and the
 * on-load client redirect all decide with the same rule, from the same two
 * environment values. Both are inlined into the client bundle by
 * next.config.ts, so process.env reads them in the browser too. No
 * "server-only" import here.
 */

/**
 * A host, reduced to just its name for comparison. Tolerant of the obvious
 * ways CANONICAL_HOST gets mis-entered by a human in a dashboard field: a
 * scheme, a trailing slash or path, a port, a trailing dot, stray whitespace,
 * mixed case. Getting this wrong on the env value would take production down on
 * deploy with a message blaming the visitor's address, so it is forgiving on
 * purpose.
 */
export function normalizeHost(host: string | null | undefined): string {
  let h = (host ?? "").trim().toLowerCase();
  h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // strip a scheme like https://
  h = h.replace(/[/?#].*$/, ""); // strip any path, query or fragment
  h = h.replace(/\.+$/, ""); // strip a trailing dot (FQDN root, or a typo)
  h = h.replace(/:\d+$/, ""); // strip a port
  return h;
}

/**
 * The allowed hosts, in order. The first is canonical (redirect target). Reads
 * the comma-separated CANONICAL_HOST unless a raw value is passed (tests). Each
 * entry is normalized and blanks are dropped, so "  https://A/ , b " parses to
 * ["a", "b"].
 */
export function canonicalHosts(raw: string | null | undefined = process.env.CANONICAL_HOST): string[] {
  return (raw ?? "")
    .split(",")
    .map(normalizeHost)
    .filter(Boolean);
}

/** The one canonical host -- the first entry -- for building a redirect target
 * or naming the real address. Empty when unset. */
export function canonicalHost(raw: string | null | undefined = process.env.CANONICAL_HOST): string {
  return canonicalHosts(raw)[0] ?? "";
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

/** True when the host matches any allowed canonical host. */
export function isCanonicalHost(
  host: string | null | undefined,
  raw: string | null | undefined = process.env.CANONICAL_HOST,
): boolean {
  const target = normalizeHost(host);
  if (!target) return false;
  return canonicalHosts(raw).includes(target);
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
  opts: { context?: string; canonical?: string | null } = {},
): string | null {
  const context = opts.context ?? deployContext();
  if (!hostGuardEnforced(context)) return null; // previews, branch deploys, dev
  const raw = opts.canonical ?? process.env.CANONICAL_HOST;
  const hosts = canonicalHosts(raw);
  if (hosts.length === 0)
    return "A Teacher’s Best Friend is temporarily unavailable (the site address isn’t configured). Please try again shortly or contact support.";
  if (hosts.includes(normalizeHost(host))) return null;
  const primary = hosts[0];
  return `A Teacher’s Best Friend runs at https://${primary}. This copy at ${
    normalizeHost(host) || "this address"
  } is an old preview and can no longer be used — please go to https://${primary} and update your bookmark.`;
}

/** The address the client should redirect to on load, or null to stay put.
 * Same rule as hostRefusal, but a bad host on a real page is rescued by moving
 * the person to the canonical site (keeping their path) rather than showing an
 * error -- that is what saves a bookmark. The FIRST canonical host is the
 * target, so a domain switchover sends stale bookmarks to the new domain. */
export function canonicalRedirectTarget(
  location: { host: string; pathname: string; search: string; hash: string },
  opts: { context?: string; canonical?: string | null } = {},
): string | null {
  const context = opts.context ?? deployContext();
  if (!hostGuardEnforced(context)) return null;
  const raw = opts.canonical ?? process.env.CANONICAL_HOST;
  const hosts = canonicalHosts(raw);
  if (hosts.length === 0) return null; // nothing to redirect to; the server fails loud
  if (hosts.includes(normalizeHost(location.host))) return null;
  return `https://${hosts[0]}${location.pathname}${location.search}${location.hash}`;
}
