import type { NextConfig } from "next";

// Content-Security-Policy. We deliberately scope only the high-value directives
// that can't break Next.js hydration: clickjacking (frame-ancestors), base-tag
// injection (base-uri), plugin/embed abuse (object-src), and form-action
// hijacking. script-src/style-src are left to default (unrestricted) because a
// strict policy needs per-request nonces; that's a future hardening, tracked
// separately. form-action allows the Microsoft OAuth redirect used by the
// OneDrive integration.
const CSP = [
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self' https://login.microsoftonline.com",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: CSP },
  // Force HTTPS for two years, including subdomains (Vercel is HTTPS-only).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Belt-and-suspenders clickjacking protection alongside frame-ancestors.
  { key: "X-Frame-Options", value: "DENY" },
  // Block MIME-type sniffing.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Don't leak full URLs (which can carry tokens) to third parties.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Disable powerful APIs this app never uses.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  // Don't advertise the framework/version.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
