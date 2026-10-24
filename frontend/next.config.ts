import type { NextConfig } from "next";

const backend = (process.env.BACKEND_INTERNAL_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const config: NextConfig = {
  // Account mode is forced for this deployment, ignoring any dashboard
  // NEXT_PUBLIC_WORKSPACE_MODE=browser setting: that setting was still
  // winning over the previous "default to backend" change, so production
  // kept serving Candidate / Local Preview with unlimited minutes, and
  // paid plans fell back to preview plans (checkout unavailable), which
  // is why plan buttons linked to /contact instead of checkout. The
  // local-preview browser mode is therefore disabled on this deployment;
  // re-enable it only by changing this line, not by an env var.
  env: { NEXT_PUBLIC_WORKSPACE_MODE: "backend" },
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
