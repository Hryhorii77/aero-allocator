import type { NextConfig } from "next";
import { cspEnforced, cspReportOnly } from "./lib/csp";

// Baseline headers. The full Content Security Policy is report-only (see lib/csp.ts): the wallet dialogs, WalletConnect and the inline theme
// script need a tuned policy, and an enforced wrong one would silently break connecting. Only object-src, base-uri, form-action and
// frame-ancestors are enforced, which no live report ever hit. Production only: `next dev` needs eval, and the phone-layout iframe check
// (CLAUDE.md, Gotchas) runs against the dev server, where X-Frame-Options is the only framing header to relax.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  ...(process.env.NODE_ENV === "production"
    ? [
        { key: "Content-Security-Policy", value: cspEnforced() },
        { key: "Content-Security-Policy-Report-Only", value: cspReportOnly() },
      ]
    : []),
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
