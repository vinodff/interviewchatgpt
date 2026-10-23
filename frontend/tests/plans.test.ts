import { afterEach, describe, expect, it, vi } from "vitest";
import { formatPlanPrice, parsePlans, previewPlans } from "@/lib/plans";
import { loadPlans } from "@/lib/server-plans";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("the three interview plans", () => {
  it("shows transparent monthly prices and distinct allowances", () => {
    const catalog = previewPlans();
    expect(catalog.plans.map(plan => [plan.id, plan.amount, plan.minutes])).toEqual([
      ["free", 0, 2],
      ["starter", 10000, 20],
      ["pro", 20000, 45],
      ["value", 50000, 120],
    ]);
    expect(formatPlanPrice(10000)).toBe("₹100");
    expect(formatPlanPrice(20000)).toBe("₹200");
    expect(formatPlanPrice(50000)).toBe("₹500");
    expect(catalog.plans.every(plan => !plan.checkout_available)).toBe(true);
  });
  it("does not enable payment for preview, incomplete, or malformed plans", () => {
    const catalog = previewPlans();
    catalog.plans[1].checkout_available = true;
    expect(parsePlans(catalog)?.plans[1].checkout_available).toBe(false);
    expect(parsePlans({ preview: false, plans: [] })).toBeNull();
    catalog.plans[1].amount = -1;
    expect(parsePlans(catalog)).toBeNull();
  });
  it("uses actual service allowances and payment availability when reachable", async () => {
    vi.stubEnv("NEXT_PUBLIC_WORKSPACE_MODE", "backend");
    vi.stubEnv("BACKEND_INTERNAL_URL", "http://127.0.0.1:8001");
    const actual = previewPlans(); actual.preview = false; actual.plans[1].minutes = 240; actual.plans[1].checkout_available = true;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(actual)));
    expect(await loadPlans()).toEqual(actual);
  });
  it("fails closed during service failures without enabling fake checkout", async () => {
    vi.stubEnv("NEXT_PUBLIC_WORKSPACE_MODE", "backend");
    vi.stubEnv("BACKEND_INTERNAL_URL", "http://127.0.0.1:8001");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await loadPlans()).toEqual(previewPlans());
  });
});
