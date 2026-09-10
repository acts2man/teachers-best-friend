import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
