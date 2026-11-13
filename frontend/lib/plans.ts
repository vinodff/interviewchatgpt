export type PlanId = "free" | "starter" | "pro" | "value";
export type Plan = { id: PlanId; name: string; minutes: number; amount: number; currency: "inr"; checkout_available: boolean };
export type PlanCatalog = { preview: boolean; plans: Plan[]; gateway?: "cashfree" | "stripe" };
export type PaidPlanId = Exclude<PlanId, "free">;

/** Single source of truth for paid prices (whole rupees). Checkout, verification and display all read this. */
export const PAID_PLANS: Readonly<Record<PaidPlanId, { name: string; minutes: number; amountInr: number }>> = {
  starter: { name: "Starter", minutes: 20, amountInr: 199 },
  pro: { name: "Popular", minutes: 60, amountInr: 499 },
  value: { name: "Value", minutes: 150, amountInr: 999 },
};

/** Builds the catalog in display order; amounts are in paise as the API returns them. */
export function buildPlans(checkoutAvailable: boolean): Plan[] {
  const paid = (Object.keys(PAID_PLANS) as PaidPlanId[]).map(id => ({
    id, name: PAID_PLANS[id].name, minutes: PAID_PLANS[id].minutes, amount: PAID_PLANS[id].amountInr * 100, currency: "inr" as const, checkout_available: checkoutAvailable,
  }));
  return [{ id: "free", name: "Free", minutes: 2, amount: 0, currency: "inr", checkout_available: false }, ...paid];
}

/** Safe launch prices when account services are offline: display prices, never enable payment. */
export function previewPlans(): PlanCatalog {
  return { preview: true, plans: buildPlans(false) };
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

/** Per-live-minute price in rupees (two decimals), or null when a plan has no paid minutes. */
export function perMinuteLabel(amountPaise: number, minutes: number): string | null {
  if (minutes <= 0 || amountPaise <= 0) return null;
  // Round in whole paise first: 832.5 paise must show ₹8.33, and float toFixed would give ₹8.32.
  return `₹${(Math.round(amountPaise / minutes) / 100).toFixed(2)}`;
}

/** Whole-percent saving per minute against Starter, rounded down so the badge never overstates it. */
export function savingsVsStarter(id: PaidPlanId): number | null {
  if (id === "starter") return null;
  const base = PAID_PLANS.starter.amountInr / PAID_PLANS.starter.minutes;
  const rate = PAID_PLANS[id].amountInr / PAID_PLANS[id].minutes;
  const percent = Math.floor((1 - rate / base) * 100);
  return percent > 0 ? percent : null;
}

/**
 * What these minutes would cost at the Starter per-minute rate, in whole rupees.
 * Shown struck through as an honest anchor; null when it would not exceed the real price.
 */
export function starterRatePrice(amountPaise: number, minutes: number): number | null {
  if (minutes <= 0 || amountPaise <= 0) return null;
  const anchor = Math.round((PAID_PLANS.starter.amountInr / PAID_PLANS.starter.minutes) * minutes);
  return anchor * 100 > amountPaise ? anchor : null;
}

export function formatPlanPrice(amount: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount / 100);
}
