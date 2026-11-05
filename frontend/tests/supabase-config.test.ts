import { afterEach, describe, expect, it, vi } from "vitest";

const createClient = vi.fn((...args: unknown[]) => { void args; return { auth: {} }; });
vi.mock("@supabase/supabase-js", () => ({ createClient: (...args: unknown[]) => createClient(...args) }));
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); createClient.mockClear(); });

describe("optional Google authentication configuration", () => {
  it.each([["", ""], ["https://own-project.supabase.co", ""], ["", "public-key"]])("does not use a fallback project when either setting is absent", async (url, key) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url); vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", key);
    const { supabase } = await import("../lib/supabase");
    expect(supabase).toBeNull(); expect(createClient).not.toHaveBeenCalled();
  });
  it("uses the configured project exclusively", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://own-project.supabase.co"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-key");
    const { supabase } = await import("../lib/supabase");
    expect(supabase).not.toBeNull();
    expect(createClient).toHaveBeenCalledWith("https://own-project.supabase.co", "public-key", expect.objectContaining({ auth: expect.objectContaining({ persistSession: true }) }));
  });
});
