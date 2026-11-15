// Meta (Facebook) Pixel helpers. Pixel ID can be overridden with NEXT_PUBLIC_META_PIXEL_ID.
export const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim() || "1153830447059052";

type Fbq = (...args: unknown[]) => void;

function fbq(): Fbq | null {
  if (typeof window === "undefined" || !META_PIXEL_ID) return null;
  const f = (window as unknown as { fbq?: Fbq }).fbq;
  return typeof f === "function" ? f : null;
}

function once(key: string): boolean {
  try {
    const k = `iw_px_${key}`;
    if (window.sessionStorage.getItem(k)) return false;
    window.sessionStorage.setItem(k, "1");
  } catch {
    /* storage unavailable: still track */
  }
  return true;
}

/** Fire once per new account (account created in the last 10 minutes). */
export function trackSignup(userId: string, createdAt?: string) {
  const f = fbq();
  if (!f || !createdAt) return;
  const ageMs = Date.now() - new Date(createdAt).getTime();
  if (!(ageMs >= 0 && ageMs < 10 * 60 * 1000)) return;
  if (!once(`signup_${userId}`)) return;
  f("track", "CompleteRegistration", { content_name: "InterviewWin signup" });
}

/** Fire once per paid order. */
export function trackPurchase(orderId: string, valueInr: number, plan: string) {
  const f = fbq();
  if (!f || !once(`purchase_${orderId}`)) return;
  f("track", "Purchase", { value: valueInr, currency: "INR", content_name: plan }, { eventID: orderId });
}

/** Fire when checkout starts. */
export function trackInitiateCheckout(plan: string, valueInr?: number) {
  const f = fbq();
  if (!f) return;
  f("track", "InitiateCheckout", { content_name: plan, ...(valueInr ? { value: valueInr, currency: "INR" } : {}) });
}
