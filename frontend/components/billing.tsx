import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, CreditCard } from "lucide-react";
import { ApiError, messageOf, post } from "@/lib/api";
import { formatPlanPrice, parsePlans, type PlanCatalog, type PlanId } from "@/lib/plans";
import { useOwnedApi } from "@/lib/use-owned-api";
import type { Health, User } from "@/lib/types";
import { Alert, Button, SectionHeader } from "./ui";

declare global {
  interface Window {
    Cashfree?: (config: { mode: "production" | "sandbox" }) => {
      checkout: (options: {
        paymentSessionId: string;
        redirectTarget?: "_self" | "_blank" | "_top" | "_modal";
      }) => Promise<{ error?: { message?: string }; redirect?: boolean }>;
    };
  }
}

export function Billing({
  user,
  health,
  selectedPlan,
}: {
  user: User;
  health: Health | null;
  selectedPlan?: "starter" | "pro" | "value";
}) {
  const api = useOwnedApi();
  const [catalog, setCatalog] = useState<PlanCatalog | null>(null);
  const [gateway, setGateway] = useState<"cashfree" | "stripe">("cashfree");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [returnStatus] = useState(() =>
    typeof window === "undefined"
      ? ""
      : new URLSearchParams(window.location.search).get("billing") || ""
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/plans", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("We couldn’t load current prices. Refresh to try again.");
        const data = await response.json();
        const value = parsePlans(data);
        if (!value)
          throw new Error("We couldn’t load current prices. Refresh to try again.");
        if (!controller.signal.aborted) {
          setCatalog(value);
          if (data && typeof data === "object" && data.gateway) {
            setGateway(data.gateway);
          }
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(messageOf(err));
      });
    return () => controller.abort();
  }, []);

  async function pollCashfreeOrder(orderId: string) {
    setBusy("verifying");
    setError("");
    let isPaid = false;

    // Check immediately when user switches back to this tab
    const onFocus = () => {
      void checkOnce();
    };
    window.addEventListener("focus", onFocus);

    async function checkOnce(): Promise<boolean> {
      try {
        const res = await api<{
          status: string;
          order_id: string;
          plan: string;
          minutes_granted: number;
        }>(`/billing/cashfree/verify/${orderId}`);

        if (res.status === "PAID") {
          isPaid = true;
          setSuccess(
            `Payment confirmed! Your ${res.plan.toUpperCase()} plan is now active with ${res.minutes_granted} minutes.`
          );
          setBusy(null);
          window.removeEventListener("focus", onFocus);
          setTimeout(() => {
            window.location.assign("/interview?view=billing");
          }, 2500);
          return true;
        }
      } catch {
        /* continue polling */
      }
      return false;
    }

    try {
      // Poll every 3s for up to 3 minutes (60 iterations)
      for (let i = 0; i < 60; i++) {
        if (isPaid) break;
        const confirmed = await checkOnce();
        if (confirmed) return;
        await new Promise((r) => setTimeout(r, 3000));
      }
    } finally {
      window.removeEventListener("focus", onFocus);
    }

    if (!isPaid) {
      setBusy(null);
      setError(
        "We are still awaiting payment confirmation. If you completed payment, refresh this page to update your plan."
      );
    }
  }

  // Handle return with cf_order_id query param
  useEffect(() => {
    if (typeof window === "undefined") return;
    const orderId = new URLSearchParams(window.location.search).get("cf_order_id");
    if (orderId) {
      void pollCashfreeOrder(orderId);
    }
  }, []);

  async function handleCheckout(plan: PlanId) {
    if (plan === "free") return;
    setBusy(plan);
    setError("");
    setSuccess("");

    if (gateway === "cashfree") {
      try {
        const res = await api<{
          order_id: string;
          payment_session_id: string;
          amount: number;
          plan: string;
          environment: string;
        }>("/billing/cashfree/create-order", post({ plan }));

        // Open the whitelisted Cashfree checkout bridge on GitHub Pages
        // This avoids Cashfree's strict domain whitelisting errors on localhost and non-production hosts
        const bridgeUrl = `https://vinodff.github.io/incoin-auto-v1/cashfree-checkout.html?session_id=${res.payment_session_id}`;
        
        const popup = window.open(bridgeUrl, "_blank");
        if (!popup || popup.closed || typeof popup.closed === "undefined") {
          // If popup was blocked by browser, redirect directly
          window.location.href = bridgeUrl;
          return;
        }

        // Active verification polling while the user completes payment
        await pollCashfreeOrder(res.order_id);
      } catch (err) {
        setError(messageOf(err));
        setBusy(null);
      }
    } else {
      // Legacy Stripe checkout
      try {
        const { url } = await api<{ url: string }>(
          "/billing/checkout",
          post({ plan })
        );
        const target = new URL(url);
        if (
          target.protocol !== "https:" ||
          !(
            target.hostname === "stripe.com" ||
            target.hostname.endsWith(".stripe.com")
          )
        ) {
          throw new Error("We couldn’t open secure checkout. Please try again or contact support.");
        }
        window.location.assign(target.toString());
      } catch (err) {
        setError(
          err instanceof ApiError && err.status >= 500
            ? "We couldn’t open checkout. Try again later or contact support."
            : messageOf(err)
        );
        setBusy(null);
      }
    }
  }

  async function openPortal() {
    setBusy("portal");
    setError("");
    try {
      const { url } = await api<{ url: string }>("/billing/portal", post());
      window.location.assign(url);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status >= 500
          ? "We couldn’t open subscription management. Contact support if you need help."
          : messageOf(err)
      );
      setBusy(null);
    }
  }

  const paid =
    user.plan === "starter" || user.plan === "pro" || user.plan === "value";
  const canManage = !user.testing_mode && user.minute_limit !== null;
  const available =
    catalog?.preview === false && (catalog?.gateway === "cashfree" || (!user.testing_mode && user.minute_limit !== null));

  return (
    <>
      <SectionHeader
        eyebrow="MORE TIME FOR YOUR INTERVIEWS"
        title="Plans & billing"
        description="See your minutes, compare plans, and upgrade your live interview time."
      />

      {error && <Alert>{error}</Alert>}
      {success && (
        <Alert tone="success">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <CheckCircle2 size={18} />
            <span>{success}</span>
          </div>
        </Alert>
      )}
      {returnStatus === "success" && (
        <Alert tone="info">
          {paid
            ? "Your confirmed plan is shown below."
            : "We’re waiting for payment confirmation. Refresh your interview to check your plan."}
        </Alert>
      )}
      {returnStatus === "cancelled" && (
        <Alert tone="info">You left checkout. You can review the plans below.</Alert>
      )}

      <section className="panel billing-summary">
        <div>
          <p className="eyebrow">YOUR CURRENT PLAN</p>
          <h2>
            {user.testing_mode || user.minute_limit === null
              ? "Preview access"
              : `${user.plan.charAt(0).toUpperCase()}${user.plan.slice(1)}`}
          </h2>
          <p>
            {user.minute_limit === null
              ? `${Math.ceil(user.minutes_used)} live minutes used. Preview access has no application minute limit.`
              : `${Math.max(0, Math.ceil(user.minute_limit - user.minutes_used))} of ${user.minute_limit} minutes remaining this month.`}
          </p>
        </div>
        {(paid || user.billing_account) && (
          <Button
            variant="secondary"
            disabled={!canManage || !!busy}
            busy={busy === "portal"}
            onClick={() => {
              void openPortal();
            }}
          >
            <CreditCard size={17} /> Manage subscription
          </Button>
        )}
      </section>

      {!available && catalog && (
        <Alert tone="info">
          Paid upgrades are not available right now.{" "}
          <Link href="/contact">Contact support</Link> if you have a billing question.
        </Alert>
      )}

      {!catalog && !error && <p role="status">Loading plans…</p>}

      {selectedPlan && (
        <p className="selected-plan-note">
          You selected{" "}
          {selectedPlan === "starter"
            ? "Starter"
            : selectedPlan === "pro"
            ? "Popular"
            : "Value"}
          . Review the plan below before continuing.
        </p>
      )}

      <div className="account-plan-grid">
        {catalog?.plans.map((plan) => (
          <section
            className={`panel account-plan ${
              plan.id === selectedPlan ? "account-plan-selected" : ""
            }`}
            key={plan.id}
          >
            <h2>{plan.name}</h2>
            <div className="account-plan-price">
              {formatPlanPrice(plan.amount)}
              <small>{plan.id === "free" ? " forever" : " / month"}</small>
            </div>
            <p>{plan.minutes} live minutes per calendar month</p>
            {plan.id === user.plan ? (
              <span className="account-plan-current">Current plan</span>
            ) : plan.id === "free" ? (
              <p className="muted small">Included free tier with {plan.minutes} monthly minutes.</p>
            ) : (
              <Button
                disabled={!plan.checkout_available || !!busy}
                busy={busy === plan.id}
                onClick={() => {
                  void handleCheckout(plan.id);
                }}
              >
                Choose {plan.name}
                <ArrowRight size={16} />
              </Button>
            )}
          </section>
        ))}
      </div>

      <p className="billing-footnote">
        Payments are securely processed via Cashfree (UPI, Cards, NetBanking, Wallets).
        Minutes reset each calendar month and do not roll over.
      </p>
    </>
  );
}
