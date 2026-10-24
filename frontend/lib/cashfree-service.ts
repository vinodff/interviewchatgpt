import { supabase } from "./supabase";

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

const SUPABASE_CREATE_ORDER_URL =
  "https://vcpvpzxytleafevindjb.supabase.co/functions/v1/cashfree-create-order";
const SUPABASE_VERIFY_ORDER_URL =
  "https://vcpvpzxytleafevindjb.supabase.co/functions/v1/cashfree-verify-order";
const HOSTED_CHECKOUT_URL =
  "https://vinodff.github.io/incoin-auto-v1/cashfree-checkout.html";

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

    // Primary: Call Supabase Edge Function
    try {
      const response = await fetch(SUPABASE_CREATE_ORDER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.payment_session_id && data.order_id) {
          return {
            order_id: data.order_id,
            payment_session_id: data.payment_session_id,
            amount: params.amount,
            plan: params.plan,
          };
        }
      }
    } catch {
      // Fallback to Next.js route if Edge function network had a momentary blip
    }

    // Fallback: Next.js internal API
    const fallbackRes = await fetch("/api/billing/cashfree/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    // Primary: Supabase Edge Function
    try {
      const response = await fetch(SUPABASE_VERIFY_ORDER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: orderId }),
      });

      if (response.ok) {
        const data = await response.json();
        return {
          order_status: data.order_status || "UNKNOWN",
          order_amount: data.order_amount,
          cf_payment_id: data.cf_payment_id,
        };
      }
    } catch {
      // Fallback to Next.js route
    }

    // Fallback: Next.js internal API
    const fallbackRes = await fetch(`/api/billing/cashfree/verify/${encodeURIComponent(orderId)}`);
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
   * Tries Cashfree JS SDK v3 modal first, and falls back to the whitelisted GitHub Pages bridge.
   */
  static async openCheckout(paymentSessionId: string): Promise<boolean> {
    if (!paymentSessionId) return false;

    // 1. Try Cashfree SDK v3 Modal
    if (typeof window !== "undefined" && (window as any).Cashfree) {
      try {
        const cf = (window as any).Cashfree({ mode: "production" });
        const res = await cf.checkout({
          paymentSessionId,
          redirectTarget: "_modal",
        });
        if (!res?.error) {
          return true;
        }
      } catch {
        // Modal failed or popup blocker caught it, proceed to hosted bridge
      }
    }

    // 2. Fall back to hosted GitHub Pages checkout bridge
    const bridgeUrl = `${HOSTED_CHECKOUT_URL}?session_id=${encodeURIComponent(paymentSessionId)}`;
    const popup = window.open(bridgeUrl, "_blank");
    if (!popup || popup.closed || typeof popup.closed === "undefined") {
      window.location.href = bridgeUrl;
    }
    return true;
  }

  /**
   * Finalizes credits in the database via the Supabase add_credits RPC function.
   */
  static async finalizeCredits(minutes: number, plan: string): Promise<void> {
    try {
      const { error } = await supabase.rpc("add_credits", {
        p_amount: minutes,
        p_plan: plan,
      });
      if (error) {
        console.warn("RPC add_credits returned an error:", error.message);
      }
    } catch (err: any) {
      console.warn("Could not call add_credits RPC directly:", err?.message);
    }
  }
}
