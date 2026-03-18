import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  outputFileTracingIncludes: {
    "/api/analyse/worker": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/analyse/worker/route": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
}

export default nextConfig