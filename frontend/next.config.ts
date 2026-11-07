import type { NextConfig } from "next";

// The browser only ever talks to this origin; /api/* is forwarded to the backend,
// so the session cookie is first-party and no CORS setup is needed.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:4000";

// On Vercel a missing BACKEND_URL would silently point every API call at localhost. Fail the build instead.
if (process.env.VERCEL && !process.env.BACKEND_URL) {
  throw new Error("BACKEND_URL is not set. Set it to the backend project's URL in the Vercel project settings.");
}

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` }];
  },
};

export default nextConfig;
