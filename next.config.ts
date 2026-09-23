import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Netlify sets COMMIT_REF, BRANCH and CONTEXT during the build, not in the
  // function runtime, so /api/version read them as null. next.config runs at
  // build time, so inlining them here is what actually gets the value into the
  // deployed bundle. Without this the endpoint answers "what is deployed?"
  // with a shrug, which is the question it exists to answer.
  env: {
    COMMIT_REF: process.env.COMMIT_REF ?? "",
    BRANCH: process.env.BRANCH ?? "",
    CONTEXT: process.env.CONTEXT ?? "",
    BUILD_TIME: new Date().toISOString(),
    // The one address the app is allowed to serve from (lib/canonical-host.ts).
    // Inlined here at build time for the same reason CONTEXT is: the host guard
    // runs both server-side (proxy.ts, guardOrigin) and in the browser (the
    // on-load canonical redirect), and both must read the same value. Must be
    // set at build scope in Netlify, alongside CONTEXT. Empty is handled as
    // "fail loud in production" -- see hostRefusal().
    CANONICAL_HOST: process.env.CANONICAL_HOST ?? "",
  },
  /**
   * Redirects here run BEFORE routing, so a source that matches a real page
   * shadows it completely -- the page is built, deployed, and never reached.
   *
   * That is exactly what happened to /signup. This list carried
   * { source: "/signup", destination: "/login" } from 2026-09-14, back when
   * there was no sign-up page and /login was the whole story. When
   * app/signup/page.tsx was added it never rendered in production: the live
   * site answered GET /signup?plan=tier1 with a 307 to /login?plan=tier1, so
   * a teacher who picked a paid plan arrived in SIGN-IN mode with their choice
   * silently dropped.
   *
   * tests/next-config-redirects.test.mjs now fails if any source here matches
   * a page.tsx or route.ts under app/, so this cannot be reintroduced quietly.
   */
  async redirects() {
    return [
      // Student work now lives inside each assessment. There is no app/review,
      // so this shadows nothing.
      { source: "/review", destination: "/assessments", permanent: false },
    ];
  },
  webpack(config, { isServer }) {
    if (isServer) {
      // Workers bindings are loaded on demand by teacher-server. Keep this
      // runtime-only module out of the native Next.js server bundle so that
      // importing an API route does not crash deployment or page collection.
      config.externals.push({ "cloudflare:workers": "commonjs cloudflare:workers" });
    }
    return config;
  },
};

export default nextConfig;
