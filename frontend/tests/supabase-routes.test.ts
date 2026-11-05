import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "../app/api/[...path]/route";

const request = (path: string, body?: unknown, extra: Record<string, string> = {}) =>
  new NextRequest(`https://workspace.test/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "X-InterviewPilot": "1", ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const params = (path: string) => ({ params: Promise.resolve({ path: path.split("/") }) });

describe("serverless Supabase route handlers", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_WORKSPACE_MODE", "backend");
    vi.stubEnv("BACKEND_INTERNAL_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://vcpvpzxytleafevindjb.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns health reporting Supabase PostgreSQL database", async () => {
    const res = await GET(request("health"), params("health"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.database).toBe("Supabase PostgreSQL");
    expect(body.ai_configured).toBe(true);
  });

  it("returns 401 Unauthorized for /api/auth/me when unauthenticated", async () => {
    const res = await GET(request("auth/me"), params("auth/me"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.detail).toContain("Sign in is required");
  });

  it("clears session cookie on logout", async () => {
    const res = await POST(request("auth/logout"), params("auth/logout"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(res.headers.get("Set-Cookie")).toContain("interviewpilot_session=");
  });

  it("requires a valid access token on /api/auth/supabase-session", async () => {
    const res = await POST(request("auth/supabase-session", {}), params("auth/supabase-session"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.detail).toContain("access token is required");
  });
});
