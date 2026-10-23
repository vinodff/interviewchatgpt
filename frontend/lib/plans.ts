export type PlanId = "free" | "starter" | "pro" | "value";
export type Plan = { id: PlanId; name: string; minutes: number; amount: number; currency: "inr"; checkout_available: boolean };
export type PlanCatalog = { preview: boolean; plans: Plan[]; gateway?: "cashfree" | "stripe" };

/** Safe launch prices when account services are offline: display prices, never enable payment. */
export function previewPlans(): PlanCatalog {
  return { preview: true, plans: [
    { id: "free", name: "Free", minutes: 2, amount: 0, currency: "inr", checkout_available: false },
    { id: "starter", name: "Starter", minutes: 20, amount: 10000, currency: "inr", checkout_available: false },
    { id: "pro", name: "Popular", minutes: 45, amount: 20000, currency: "inr", checkout_available: false },
    { id: "value", name: "Value", minutes: 120, amount: 50000, currency: "inr", checkout_available: false },
  ] };
}

export function parsePlans(value: unknown): PlanCatalog | null {
  if (!value || typeof value !== "object" || !("plans" in value) || !("preview" in value) || typeof value.preview !== "boolean" || !Array.isArray(value.plans) || value.plans.length < 3) return null;
  const allowed = new Set(["free", "starter", "pro", "value"]);
  const plans: Plan[] = [];
  for (const item of value.plans) {
    if (!item || typeof item !== "object" || !("id" in item) || !("name" in item) || !("minutes" in item) || !("amount" in item) || !("currency" in item) || !("checkout_available" in item)) return null;
    const plan = item as { id: unknown; name: unknown; minutes: unknown; amount: unknown; currency: unknown; checkout_available: unknown };
    if (typeof plan.id !== "string" || !allowed.has(plan.id) || typeof plan.name !== "string" || plan.name.length > 30 || typeof plan.minutes !== "number" || !Number.isSafeInteger(plan.minutes) || plan.minutes < 0 || typeof plan.amount !== "number" || !Number.isSafeInteger(plan.amount) || plan.amount < 0 || plan.currency !== "inr" || typeof plan.checkout_available !== "boolean") return null;
    if (plan.id === "free" && (plan.amount !== 0 || plan.checkout_available) || plan.id !== "free" && plan.amount === 0) return null;
    plans.push({ id: plan.id as PlanId, name: plan.name, minutes: plan.minutes, amount: plan.amount, currency: plan.currency, checkout_available: !value.preview && plan.checkout_available });
  }
  const result: PlanCatalog = { preview: value.preview, plans };
  if ("gateway" in value && (value as { gateway?: unknown }).gateway === "cashfree") {
    result.gateway = "cashfree";
  }
  return result;
}

export function formatPlanPrice(amount: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount / 100);
}
