import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
