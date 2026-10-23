import { isBrowserWorkspace } from "./workspace-mode";
import { parsePlans, previewPlans, type PlanCatalog } from "./plans";

export async function loadPlans(): Promise<PlanCatalog> {
  const backend = process.env.BACKEND_INTERNAL_URL;
  if (isBrowserWorkspace() || !backend) return previewPlans();
  try {
    const response = await fetch(`${backend.replace(/\/$/, "")}/api/billing/plans`, { cache: "no-store", signal: AbortSignal.timeout(2000) });
    if (response.ok) {
      const plans = parsePlans(await response.json());
      if (plans) return plans;
    }
  } catch { /* Keep plans readable during an outage; all paid actions remain unavailable. */ }
  return previewPlans();
}
