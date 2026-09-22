// A page gate in a route handler answers "we are broken" to someone who is
// simply not allowed.
//
// requireAdmin() calls redirect(). In a page that is exactly right. In a route
// handler redirect() throws NEXT_REDIRECT, the route's own try/catch catches it
// like any other error, and apiError() maps an unrecognised throw to 503 "We
// couldn't complete that request." Verified against production before this
// fix: GET /api/admin/export/00000000-… returned 503 signed out.
//
// Nothing leaked -- the throw happens before anything is read -- but a run of
// those in the logs reads as an outage rather than as the gate working, and a
// non-admin teacher was told to try again at something they will never be
// allowed to do.
//
// These bundle the real lib/admin-gate.ts and run it, with only its edges
// stubbed: the session lookup, the database, and next/navigation's redirect.
// esbuild's buildSync cannot take plugins, so the edges are marked external
// and fed through the require shim instead.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);

function bundle(entry, { external = [], stubs = {} } = {}) {
  const r = buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    absWorkingDir: ROOT,
    external,
    alias: { "server-only": path.join(ROOT, "tests/fixtures/empty-module.cjs") },
  });
  const m = { exports: {} };
  const req = (id) => (id in stubs ? stubs[id] : require(id));
  new Function("module", "exports", "require", r.outputFiles[0].text)(m, m.exports, req);
  return m.exports;
}

/**
 * The real apiError, which is what turns a thrown HttpError into a Response,
 * and the real HttpError it recognises -- both out of the SAME bundle.
 *
 * That matters: apiError decides with `instanceof`, and two bundles of
 * lib/http-error.ts are two different classes, so an HttpError built from a
 * second copy falls through to the 503 branch and the test "reproduces" the
 * bug it is meant to have fixed. One module instance here, exactly as the
 * running app has one.
 *
 * teacher-server is heavy (next/headers, the Supabase clients, the PDF page
 * counter) and none of that is on this path, so those edges are stubbed away.
 */
const { apiError, HttpError } = bundle("lib/teacher-server.ts", {
  external: [
    "next/headers",
    "@/lib/supabase/server",
    "@/lib/supabase/service",
    "@/lib/page-count",
    "@/lib/impersonation-guard",
  ],
  stubs: {
    "next/headers": { cookies: async () => ({ get: () => undefined }), headers: async () => new Map() },
    "@/lib/supabase/server": { createClient: async () => ({}), hasSupabaseConfig: () => true },
    "@/lib/supabase/service": { createServiceClient: () => ({}) },
    "@/lib/page-count": { countPages: async () => 1, contentHash: async () => "" },
    "@/lib/impersonation-guard": { impersonationRefusal: () => null },
  },
});

/** lib/admin-gate.ts with its session lookup, database and redirect replaced. */
function gateWith({ userId = null, isAdmin = false, rpcError = null } = {}) {
  const redirects = [];
  const gate = bundle("lib/admin-gate.ts", {
    external: ["next/navigation", "./supabase-admin", "@/lib/teacher-server"],
    stubs: {
      "next/navigation": {
        redirect: (to) => {
          redirects.push(to);
          // What Next.js actually does: throws a sentinel the caller is meant
          // to let escape. Reproduced so a gate that redirects in a route is
          // caught here rather than in production.
          const e = new Error("NEXT_REDIRECT");
          e.digest = `NEXT_REDIRECT;replace;${to};307;`;
          throw e;
        },
      },
      "./supabase-admin": {
        supabaseAdmin: () => ({
          rpc: async (name, args) => {
            if (name === "is_admin")
              return { data: args.p_user === userId ? isAdmin : false, error: rpcError };
            if (name === "can_impersonate") return { data: false, error: null };
            return { data: null, error: null };
          },
          auth: {
            admin: {
              getUserById: async () => ({ data: { user: { email: "admin@school.org" } } }),
            },
          },
        }),
      },
      "@/lib/teacher-server": {
        HttpError,
        owner: async () => {
          if (!userId) throw new HttpError(401, "Please sign in to open your classroom.");
          return userId;
        },
      },
    },
  });
  return { gate, redirects };
}

// ---------------------------------------------------------------
// The new gate
// ---------------------------------------------------------------

test("requireAdminApi throws 401 when nobody is signed in", async () => {
  const { gate, redirects } = gateWith({ userId: null });
  await assert.rejects(
    () => gate.requireAdminApi(),
    (e) => {
      assert.ok(e instanceof HttpError, "throws an HttpError, not a redirect sentinel");
      assert.equal(e.status, 401);
      assert.equal(e.message, "Please sign in.");
      return true;
    },
  );
  assert.deepEqual(redirects, [], "and never calls redirect()");
});

test("requireAdminApi throws 403 for a signed-in non-admin", async () => {
  const { gate, redirects } = gateWith({ userId: "teacher-1", isAdmin: false });
  await assert.rejects(
    () => gate.requireAdminApi(),
    (e) => {
      assert.ok(e instanceof HttpError);
      assert.equal(e.status, 403);
      assert.match(e.message, /administrators/);
      return true;
    },
  );
  assert.deepEqual(redirects, []);
});

test("a database failure on is_admin is a refusal, not an admission", async () => {
  // `error || !ok` -- if the check itself cannot be made, the answer is no.
  const { gate } = gateWith({ userId: "teacher-1", isAdmin: true, rpcError: { message: "down" } });
  await assert.rejects(() => gate.requireAdminApi(), (e) => e.status === 403);
});

test("requireAdminApi returns the admin when they are one", async () => {
  const { gate, redirects } = gateWith({ userId: "admin-1", isAdmin: true });
  const admin = await gate.requireAdminApi();
  assert.equal(admin.id, "admin-1");
  assert.equal(admin.email, "admin@school.org");
  assert.deepEqual(redirects, []);
});

test("requireAdmin still redirects, because pages still want that", async () => {
  // The page gate is unchanged. This is the behaviour that was wrong in a
  // route and is right in a page, so it is pinned rather than removed.
  const { gate, redirects } = gateWith({ userId: null });
  await assert.rejects(() => gate.requireAdmin(), (e) => e.message === "NEXT_REDIRECT");
  assert.deepEqual(redirects, ["/login?next=/admin"]);

  const nonAdmin = gateWith({ userId: "teacher-1", isAdmin: false });
  await assert.rejects(() => nonAdmin.gate.requireAdmin(), (e) => e.message === "NEXT_REDIRECT");
  assert.deepEqual(nonAdmin.redirects, ["/"]);
});

// ---------------------------------------------------------------
// What the caller sees
// ---------------------------------------------------------------

test("apiError renders an HttpError with its own status, and anything else as 503", async () => {
  // This is the mapping that turned a redirect into an outage message.
  const unauthorized = apiError(new HttpError(401, "Please sign in."));
  assert.equal(unauthorized.status, 401);
  assert.equal((await unauthorized.json()).error, "Please sign in.");

  const forbidden = apiError(new HttpError(403, "That’s only available to administrators."));
  assert.equal(forbidden.status, 403);

  // A NEXT_REDIRECT escaping into a route handler looks like this.
  const redirectSentinel = new Error("NEXT_REDIRECT");
  redirectSentinel.digest = "NEXT_REDIRECT;replace;/login?next=/admin;307;";
  const mapped = apiError(redirectSentinel);
  assert.equal(mapped.status, 503, "which is exactly the 503 that was reported");
});

test("the admin export route uses the API gate", () => {
  const route = fs.readFileSync(
    path.join(ROOT, "app/api/admin/export/[teacherId]/route.ts"),
    "utf8",
  );
  assert.ok(/await requireAdminApi\(\)/.test(route));
  assert.ok(
    /import \{ requireAdminApi \} from "@\/lib\/admin-gate"/.test(route),
    "and imports only the API gate",
  );
});

// ---------------------------------------------------------------
// So it cannot come back
// ---------------------------------------------------------------

/** Gates that call redirect(). Fine in a page, wrong in a route handler. */
const REDIRECTING_GATES = new Set(["requireAdmin", "requireAppManager"]);

function apiRouteFiles(dir = path.join(ROOT, "app/api"), found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) apiRouteFiles(full, found);
    else if (/\.(ts|tsx)$/.test(entry.name)) found.push(full);
  }
  return found;
}

test("no route under app/api imports a redirecting admin gate", () => {
  const offenders = [];
  const files = apiRouteFiles();
  assert.ok(files.length > 0, "there are route files to check");

  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    // Named imports from admin-gate, however they are spelled or aliased.
    for (const m of src.matchAll(
      /import\s*\{([^}]*)\}\s*from\s*["'][^"']*admin-gate["']/g,
    )) {
      for (const part of m[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        // Exact names: requireAdminApi and requireAppManagerId both contain a
        // banned name as a prefix and are the correct things to use.
        if (REDIRECTING_GATES.has(name))
          offenders.push(`${path.relative(ROOT, file)} imports ${name}`);
      }
    }
    // A namespace import would let the same call through unseen.
    if (/import\s*\*\s*as\s+\w+\s*from\s*["'][^"']*admin-gate["']/.test(src))
      offenders.push(`${path.relative(ROOT, file)} namespace-imports admin-gate`);
  }

  assert.deepEqual(
    offenders,
    [],
    "route handlers must use requireAdminApi / requireAppManagerId, which throw 401 and 403. " +
      "A redirecting gate becomes a 503 outage message for a caller who is merely not allowed.",
  );
});

test("the guard would actually catch the mistake it exists for", () => {
  // The check above passes trivially if the matching is wrong, so the same
  // matching is run against the source it was written to reject.
  const bad = 'import { requireAdmin } from "@/lib/admin-gate";\n';
  const good = 'import { requireAdminApi } from "@/lib/admin-gate";\n';
  const namesIn = (src) =>
    [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*admin-gate["']/g)]
      .flatMap((m) => m[1].split(",").map((p) => p.trim().split(/\s+as\s+/)[0].trim()));

  assert.ok(namesIn(bad).some((n) => REDIRECTING_GATES.has(n)), "rejects the page gate");
  assert.ok(!namesIn(good).some((n) => REDIRECTING_GATES.has(n)), "accepts the API gate");
  // The prefix trap: requireAdminApi starts with requireAdmin.
  assert.ok(!REDIRECTING_GATES.has("requireAdminApi"));
  assert.ok(!REDIRECTING_GATES.has("requireAppManagerId"));
});
