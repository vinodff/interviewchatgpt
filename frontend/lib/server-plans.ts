import { buildPlans, parsePlans, previewPlans, type PlanCatalog } from "./plans";

export function livePlans(): PlanCatalog {
  return {
    preview: false,
    gateway: "cashfree",
    plans: buildPlans(true),
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

