import type { NextConfig } from "next";

const backend = (process.env.BACKEND_INTERNAL_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const config: NextConfig = {
  output: "standalone",
  experimental: { cpus: 1, workerThreads: true },
  async rewrites() {
    const backend = process.env.BACKEND_INTERNAL_URL;
    if (backend) {
      return [{ source: "/api/:path*", destination: `${backend.replace(/\/$/, "")}/api/:path*` }];
    }
    if (process.env.NODE_ENV === "development") {
      return [{ source: "/api/:path*", destination: "http://127.0.0.1:8000/api/:path*" }];
    }
    return [];
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
