export type CashfreeEnvironment = "production" | "sandbox";
type CashfreeClient = { checkout(options: { paymentSessionId: string; redirectTarget: "_modal" }): Promise<{ error?: { message?: string }; redirect?: boolean }> };
export type CashfreeFactory = (config: { mode: CashfreeEnvironment }) => CashfreeClient;
declare global { interface Window { Cashfree?: CashfreeFactory } }

export function paymentPhone(value: string): string | null {
  const normalized = value.trim().replace(/[ -]/g, "").replace(/^\+91/, "");
  return /^[6-9][0-9]{9}$/.test(normalized) ? normalized : null;
}

export function validOrderId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
}

export function checkoutOrder(value: unknown, plan: string, amount: number): { order_id: string; payment_session_id: string; environment: CashfreeEnvironment } {
  if (!value || typeof value !== "object") throw new Error("The payment service returned an invalid checkout. Please try again.");
  const order = value as Record<string, unknown>;
  if (!validOrderId(order.order_id) || typeof order.payment_session_id !== "string" || !order.payment_session_id.trim() || order.payment_session_id.length > 4096 || order.plan !== plan || order.amount !== amount || order.environment !== "production" && order.environment !== "sandbox") throw new Error("The payment service returned an invalid checkout. Please try again.");
  return { order_id: order.order_id, payment_session_id: order.payment_session_id, environment: order.environment };
}

export function stripeDestination(value: unknown): string {
  if (typeof value !== "string") throw new Error("We couldn’t open secure checkout. Please contact support.");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || !(url.hostname === "stripe.com" || url.hostname.endsWith(".stripe.com"))) throw new Error("We couldn’t open secure checkout. Please contact support.");
  return url.toString();
}

let sdk: Promise<CashfreeFactory> | null = null;
export function loadCashfree(): Promise<CashfreeFactory> {
  if (window.Cashfree) return Promise.resolve(window.Cashfree);
  if (sdk) return sdk;
  sdk = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
    script.async = true;
    const cleanup = () => { clearTimeout(timeout); script.onload = null; script.onerror = null; };
    const fail = () => { cleanup(); script.remove(); sdk = null; reject(new Error("Secure checkout could not load. Check your connection and try again.")); };
    const timeout = setTimeout(fail, 15000);
    script.onload = () => { cleanup(); if (window.Cashfree) resolve(window.Cashfree); else fail(); };
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return sdk;
}
