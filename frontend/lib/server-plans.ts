import { parsePlans, previewPlans, type PlanCatalog } from "./plans";

export function livePlans(): PlanCatalog {
  return {
    preview: false,
    gateway: "cashfree",
    plans: [
      { id: "free", name: "Free", minutes: 2, amount: 0, currency: "inr", checkout_available: false },
      { id: "starter", name: "Starter", minutes: 20, amount: 10000, currency: "inr", checkout_available: true },
      { id: "pro", name: "Popular", minutes: 45, amount: 20000, currency: "inr", checkout_available: true },
      { id: "value", name: "Value", minutes: 120, amount: 50000, currency: "inr", checkout_available: true },
    ],
  };
}

export async function loadPlans(): Promise<PlanCatalog> {
  const backend = process.env.BACKEND_INTERNAL_URL;
  if (backend) {
    try {
      const response = await fetch(`${backend.replace(/\/$/, "")}/api/billing/plans`, { cache: "no-store", signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        const plans = parsePlans(await response.json());
        if (plans) return plans;
      }
    } catch {
      return previewPlans();
    }
    return previewPlans();
  }
  return livePlans();
}

