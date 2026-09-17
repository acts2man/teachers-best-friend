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
  },
  async redirects() {
    // Student work now lives inside each assessment.
    return [
      { source: "/review", destination: "/assessments", permanent: false },
      // The landing page's "Start free" buttons; sign-up lives on /login.
      { source: "/signup", destination: "/login", permanent: false },
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
