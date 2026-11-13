import { afterEach, describe, expect, it, vi } from "vitest";
import { formatPlanPrice, parsePlans, perMinuteLabel, previewPlans, savingsVsStarter, starterRatePrice } from "@/lib/plans";
import { loadPlans } from "@/lib/server-plans";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("the three interview plans", () => {
  it("shows transparent monthly prices and distinct allowances", () => {
    const catalog = previewPlans();
    expect(catalog.plans.map(plan => [plan.id, plan.amount, plan.minutes])).toEqual([
      ["free", 0, 2],
      ["starter", 19900, 20],
      ["pro", 49900, 60],
      ["value", 99900, 150],
    ]);
    expect(formatPlanPrice(19900)).toBe("₹199");
    expect(formatPlanPrice(49900)).toBe("₹499");
    expect(formatPlanPrice(99900)).toBe("₹999");
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

describe("per-minute value shown on pricing cards", () => {
  it("shows the honest per-minute rate for each pack", () => {
    expect(perMinuteLabel(19900, 20)).toBe("₹9.95");
    expect(perMinuteLabel(49900, 60)).toBe("₹8.32");
    expect(perMinuteLabel(99900, 150)).toBe("₹6.66");
  });
  it("rounds savings down so the badge never overstates the discount", () => {
    expect(savingsVsStarter("starter")).toBeNull();
    expect(savingsVsStarter("pro")).toBe(16);
    expect(savingsVsStarter("value")).toBe(33);
  });
  it("returns nothing for zero-minute plans instead of dividing by zero", () => {
    expect(perMinuteLabel(0, 0)).toBeNull();
    expect(starterRatePrice(0, 0)).toBeNull();
  });
  it("anchors bigger packs to what the same minutes cost at the Starter rate", () => {
    expect(starterRatePrice(49900, 60)).toBe(597);
    expect(starterRatePrice(99900, 150)).toBe(1493);
  });
  it("shows no anchor when it would not exceed the real price", () => {
    expect(starterRatePrice(19900, 20)).toBeNull();
  });
});
