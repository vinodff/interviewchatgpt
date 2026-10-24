import type { NextConfig } from "next";

const backend = (process.env.BACKEND_INTERNAL_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const config: NextConfig = {
  // Production must never silently fall back to the local-preview build:
  // a Vercel build without BACKEND_INTERNAL_URL used to become "browser"
  // mode, showing Candidate / Local Preview with unlimited minutes instead
  // of login and the user's own minutes. Browser mode is now explicit
  // opt-in only (set NEXT_PUBLIC_WORKSPACE_MODE=browser); every other
  // build is the account mode, with login and real minute limits.
  env: { NEXT_PUBLIC_WORKSPACE_MODE: process.env.NEXT_PUBLIC_WORKSPACE_MODE || "backend" },
  output: "standalone",
  experimental: { cpus: 1, workerThreads: true },
  async rewrites() {
    // Route handlers own proxying so Set-Cookie and backend failures are preserved.
    if (process.env.VERCEL || process.env.NEXT_PUBLIC_WORKSPACE_MODE === "browser") return [];
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(self), display-capture=(self)" },
    ] }];
  },
};
export default config;
