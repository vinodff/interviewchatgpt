import { resolveAuthToken } from "./api";
import { loadCashfree } from "./billing-checkout";

export interface CashfreeOrder {
  order_id: string;
  payment_session_id: string;
  amount: number;
  plan: string;
}

export interface CashfreeOrderStatus {
  order_status: "PAID" | "ACTIVE" | "EXPIRED" | "TERMINATED" | string;
  order_amount?: number;
  cf_payment_id?: string | null;
}

const HOSTED_CHECKOUT_URL =
  "https://vinodff.github.io/incoin-auto-v1/cashfree-checkout.html";

/** Both Cashfree routes authenticate the caller, so the Supabase access token must travel with them. */
async function authorizationHeader(): Promise<Record<string, string>> {
  const token = await resolveAuthToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

export class CashfreeService {
  /**
   * Creates a Cashfree payment order.
   * Calls the Supabase Edge Function broker (with fallback to Next.js API).
   */
  static async createOrder(params: {
    amount: number;
    email: string;
    phone?: string;
    plan: string;
    customerId?: string;
  }): Promise<CashfreeOrder> {
    const payload = {
      amount: params.amount,
      email: params.email || "user@interviewwin.com",
      phone: (params.phone || "9999999999").replace(/\D/g, "").slice(-10) || "9999999999",
      plan: params.plan,
      customer_id: params.customerId,
    };

    const auth = await authorizationHeader();

    const fallbackRes = await fetch("/api/billing/cashfree/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify(payload),
    });

    const fallbackData = await fallbackRes.json();
    if (!fallbackRes.ok || !fallbackData.payment_session_id) {
      throw new Error(fallbackData.detail || fallbackData.error || "Failed to create Cashfree order");
    }

    return {
      order_id: fallbackData.order_id,
      payment_session_id: fallbackData.payment_session_id,
      amount: params.amount,
      plan: params.plan,
    };
  }

  /**
   * Verifies the order status from Cashfree API.
   * Returns: ACTIVE | PAID | EXPIRED | TERMINATED
   */
  static async getOrderStatus(orderId: string): Promise<CashfreeOrderStatus> {
    const auth = await authorizationHeader();

    // Next.js internal API (use query param first to ensure static route handler takes priority over rewrites)
    let fallbackRes = await fetch(`/api/billing/cashfree/verify?order_id=${encodeURIComponent(orderId)}`, { headers: auth });
    if (!fallbackRes.ok) {
      fallbackRes = await fetch(`/api/billing/cashfree/verify/${encodeURIComponent(orderId)}`, { headers: auth });
    }
    if (fallbackRes.ok) {
      const data = await fallbackRes.json();
      return {
        order_status: data.status || data.order_status || "UNKNOWN",
        order_amount: data.order_amount,
        cf_payment_id: data.cf_payment_id,
      };
    }

    return { order_status: "UNKNOWN" };
  }

  /**
   * Launches the Cashfree Checkout UI.
   * Attempts seamless in-page modal via Cashfree JS SDK v3 first.
   * If running on non-whitelisted domain or popup blocked, falls back to hosted bridge.
   */
  static async openCheckout(paymentSessionId: string): Promise<boolean> {
    if (!paymentSessionId) return false;

    if (typeof window !== "undefined") {
      try {
        const CashfreeFactory = await loadCashfree();
        const cashfree = CashfreeFactory({ mode: "production" });
        const result = await cashfree.checkout({
          paymentSessionId,
          redirectTarget: "_modal",
        });
        if (!result?.error) {
          return true;
        }
      } catch (err) {
        console.warn("Cashfree in-page modal unavailable, using hosted checkout bridge:", err);
      }
    }

    const bridgeUrl = `${HOSTED_CHECKOUT_URL}?session_id=${encodeURIComponent(paymentSessionId)}`;
    const popup = window.open(bridgeUrl, "_blank");
    if (!popup || popup.closed || typeof popup.closed === "undefined") {
      window.location.href = bridgeUrl;
    }
    return true;
  }
}
