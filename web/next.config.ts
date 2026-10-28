import type { NextConfig } from "next";

// Baseline headers. No CSP yet: the wallet dialogs, WalletConnect and inline theme script need a
// tuned policy, and a wrong one would silently break connecting.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // @x402/next loads the Bazaar extension with a dynamic import the bundler is told to ignore (webpackIgnore), so the bundler never sees it and the
  // paid functions shipped without the package ("Cannot find package '@x402/extensions'" on every request, caught and logged). Keeping it external
  // makes the build trace it into those functions, so that import resolves.
  serverExternalPackages: ["@x402/extensions"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
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
