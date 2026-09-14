import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Canonicalize on the custom domain — scoped to the exact production
      // alias only, not a vercel.app wildcard, so deployment-specific
      // preview URLs (aero-allocator-<hash>-...vercel.app) stay reachable
      // directly for deploy verification.
      {
        source: "/:path*",
        has: [{ type: "host", value: "aero-allocator.vercel.app" }],
        destination: "https://aeroallocator.app/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
