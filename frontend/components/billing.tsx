import { useEffect, useState } from "react";
import {
  ArrowRight,
  Brain,
  Check,
  CheckCircle2,
  Clock,
  CreditCard,
  Crown,
  Database,
  FileText,
  Lock,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { ApiError, messageOf, post } from "@/lib/api";
import { parsePlans, type PlanCatalog, type PlanId } from "@/lib/plans";
import { PLAN_DETAILS, getFeatureTagClass } from "@/lib/plan-details";
import { useOwnedApi } from "@/lib/use-owned-api";
import { CashfreeService } from "@/lib/cashfree-service";
import type { Health, User } from "@/lib/types";
import { Alert, Button, SectionHeader } from "./ui";


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
  const [phone, setPhone] = useState(user.phone || "");
  const [prevUserPhone, setPrevUserPhone] = useState(user.phone || "");
  const [showPhoneModal, setShowPhoneModal] = useState<PlanId | null>(null);

  if (user.phone && user.phone !== prevUserPhone) {
    setPrevUserPhone(user.phone);
    setPhone(user.phone);
  }
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

  async function pollCashfreeOrder(orderId: string, expectedPlan?: string) {
    setBusy("verifying");
    setError("");
    let isPaid = false;

    const onFocus = () => {
      void checkOnce();
    };
    window.addEventListener("focus", onFocus);

    async function checkOnce(): Promise<boolean> {
      try {
        const res = await CashfreeService.getOrderStatus(orderId);

        if (res.order_status === "PAID") {
          isPaid = true;
          const planToUse =
            expectedPlan ||
            (res.order_amount && res.order_amount >= 500
              ? "value"
              : res.order_amount && res.order_amount >= 200
              ? "pro"
              : "starter");
          const minutesGranted =
            planToUse === "value" ? 120 : planToUse === "pro" ? 45 : 20;

          setSuccess(
            `Payment confirmed! Your ${planToUse.toUpperCase()} plan is now active with ${minutesGranted} minutes.`
          );
          setBusy(null);
          window.removeEventListener("focus", onFocus);
          setTimeout(() => {
            window.location.assign("/interview?view=billing");
          }, 2000);
          return true;
        }
      } catch {
        /* continue polling */
      }
      return false;
    }

    try {
      // Poll every 2.5s for up to 3 minutes (72 iterations)
      for (let i = 0; i < 72; i++) {
        if (isPaid) break;
        const confirmed = await checkOnce();
        if (confirmed) return;
        await new Promise((r) => setTimeout(r, 2500));
      }
    } finally {
      window.removeEventListener("focus", onFocus);
    }

    if (!isPaid) {
      setBusy(null);
      setError(
        "Payment is being processed. Once completed, refresh this page to update your plan and minutes."
      );
    }
  }

  // Handle return with cf_order_id query param
  useEffect(() => {
    if (typeof window === "undefined") return;
    const orderId = new URLSearchParams(window.location.search).get("cf_order_id");
    if (orderId) {
      const timer = setTimeout(() => {
        void pollCashfreeOrder(orderId);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, []);

  async function handleCheckout(plan: PlanId, customerPhone?: string) {
    if (plan === "free") return;
    setBusy(plan);
    setError("");
    setSuccess("");
    setShowPhoneModal(null);

    if (gateway === "cashfree") {
      try {
        const phoneToUse = customerPhone || phone.trim() || "9876543210";
        const planAmounts: Record<string, number> = { starter: 100, pro: 200, value: 500 };
        const amount = planAmounts[plan] || 100;

        const order = await CashfreeService.createOrder({
          amount,
          email: user.email,
          phone: phoneToUse,
          plan,
          customerId: user.id,
        });

        await CashfreeService.openCheckout(order.payment_session_id);

        // Active verification polling while user completes payment
        await pollCashfreeOrder(order.order_id, plan);
      } catch (err) {
        setError(messageOf(err));
        setBusy(null);
      }
    } else {
      // Legacy Stripe checkout
      try {
        const { url } = await api<{ url: string }>("/billing/checkout", post({ plan }));
        const target = new URL(url);
        if (
          target.protocol !== "https:" ||
          !(target.hostname === "stripe.com" || target.hostname.endsWith(".stripe.com"))
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

  const paid = user.plan === "starter" || user.plan === "pro" || user.plan === "value";
  const canManage = !user.testing_mode && user.minute_limit !== null;
  const available = catalog?.preview === false;

  const minutesRemaining =
    user.minute_limit === null
      ? 0
      : Math.max(0, Math.ceil(user.minute_limit - user.minutes_used));
  const usagePercent =
    user.minute_limit && user.minute_limit > 0
      ? Math.min(100, Math.round((user.minutes_used / user.minute_limit) * 100))
      : 0;

  return (
    <div className="billing-page-wrap">
      <SectionHeader
        eyebrow="MORE TIME FOR YOUR INTERVIEWS"
        title="Plans & Live Minutes"
        description="Choose the plan that fits your interview loop. Get instant access to resume uploads, knowledge base context, and real-time AI reasoning."
      />

      <Alert tone="info">
        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
          <ShieldCheck size={20} style={{ flexShrink: 0, marginTop: "2px", color: "#15675b" }} />
          <div>
            <strong>Secured by Cashfree Payments India</strong>
            <p style={{ margin: "4px 0 0", fontSize: "13px", lineHeight: "1.6" }}>
              Pay securely via UPI (Google Pay, PhonePe, Paytm), Debit/Credit Cards, or Net Banking. Instant account activation and invoice delivery upon payment.
            </p>
          </div>
        </div>
      </Alert>

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
            ? "Your confirmed plan is active."
            : "We’re checking your payment confirmation. Minutes will appear momentarily."}
        </Alert>
      )}
      {returnStatus === "cancelled" && (
        <Alert tone="info">You left checkout. You can review the plans below anytime.</Alert>
      )}

      {/* Current Plan Summary Card */}
      <section className="panel billing-summary-modern">
        <div className="billing-summary-content">
          <div className="billing-summary-badge">
            <span className="pulse-dot" />
            CURRENT PLAN
          </div>
          <div className="billing-plan-title-row">
            <h2>{user.testing_mode || user.minute_limit === null ? "Preview Access" : `${user.plan.toUpperCase()} Plan`}</h2>
            <span className="billing-plan-pill">
              {paid ? "Active Subscription" : "Free Tier"}
            </span>
          </div>
          <p className="billing-usage-text">
            {user.minute_limit === null
              ? `${Math.ceil(user.minutes_used)} live minutes used in preview.`
              : `${minutesRemaining} of ${user.minute_limit} live minutes remaining this month`}
          </p>

          {/* Progress bar */}
          {user.minute_limit !== null && user.minute_limit > 0 && (
            <div className="billing-progress-wrap">
              <div
                className="billing-progress-bar"
                style={{ width: `${Math.min(100, 100 - usagePercent)}%` }}
              />
            </div>
          )}
        </div>

        <div className="billing-summary-actions">
          {(paid || user.billing_account) && (
            <Button
              variant="secondary"
              disabled={!canManage || !!busy}
              busy={busy === "portal"}
              onClick={() => {
                void openPortal();
              }}
            >
              <CreditCard size={16} /> Manage billing
            </Button>
          )}
        </div>
      </section>

      {/* Feature Value Banner */}
      <div className="billing-feature-highlights">
        <div className="feature-pill">
          <FileText size={16} className="text-teal" />
          <span>Upload Resume & Projects</span>
        </div>
        <div className="feature-pill">
          <Database size={16} className="text-teal" />
          <span>Custom Knowledge Base</span>
        </div>
        <div className="feature-pill">
          <Brain size={16} className="text-teal" />
          <span>AI &quot;Think&quot; &amp; Deep Reasoning</span>
        </div>
        <div className="feature-pill">
          <Sparkles size={16} className="text-teal" />
          <span>STAR Method Coaching</span>
        </div>
      </div>

      {!catalog && !error && <p role="status">Loading available plans…</p>}

      {selectedPlan && (
        <p className="selected-plan-note">
          You selected{" "}
          {selectedPlan === "starter"
            ? "Starter"
            : selectedPlan === "pro"
            ? "Popular"
            : "Value"}
          . Review your plan benefits below.
        </p>
      )}

      {/* 4-Column Responsive Grid */}
      <div className="account-plan-grid-modern">
        {catalog?.plans.map((plan) => {
          const details = PLAN_DETAILS[plan.id];
          const isSelected = plan.id === selectedPlan;
          const isCurrent = plan.id === user.plan;
          const isPopular = plan.id === "pro";
          const isValue = plan.id === "value";

          const isFree = plan.id === "free";
          const buttonClass = isPopular
            ? "plan-button-popular"
            : isValue
            ? "plan-button-value"
            : "plan-button-starter";

          return (
            <section
              className={`panel account-plan-card account-plan-${plan.id} ${
                isPopular ? "account-plan-popular" : ""
              } ${isValue ? "account-plan-value" : ""} ${
                plan.id === "starter" ? "account-plan-starter" : ""
              } ${isFree ? "account-plan-free" : ""} ${
                isSelected ? "account-plan-selected" : ""
              } ${isCurrent ? "account-plan-is-current" : ""}`}
              key={plan.id}
            >
              {/* Badge */}
              {details.badge && (
                <div
                  className="plan-badge-top"
                  style={{ backgroundColor: details.badgeColor }}
                >
                  {details.badge}
                </div>
              )}

              {/* Top Section with locked heights for perfect horizontal alignment */}
              <div className="plan-card-body-top">
                <div className="plan-header">
                  <div className="plan-name-row">
                    <h3>{plan.name}</h3>
                    {isPopular && <Crown size={18} style={{ color: "#d97706" }} />}
                  </div>
                  <p className="plan-tagline">{details.tagline}</p>
                </div>

                <div className="account-plan-price-block">
                  <span className="price-currency">₹</span>
                  <span className="price-amount">{plan.amount / 100}</span>
                  <span className="price-period">
                    {isFree ? " forever" : " / month"}
                  </span>
                </div>

                <div className={`plan-minutes-highlight plan-minutes-${plan.id}`}>
                  <Clock size={15} />
                  <strong>{plan.minutes} Live Minutes</strong>
                </div>

                {/* Action Button */}
                <div className="plan-cta-box">
                  {isCurrent ? (
                    <div className="account-plan-current-tag">
                      <CheckCircle2 size={16} /> Current active plan
                    </div>
                  ) : isFree ? (
                    <div className="account-plan-free-included">
                      Default free tier included
                    </div>
                  ) : (
                    <Button
                      className={`plan-button-main ${buttonClass}`}
                      busy={busy === plan.id}
                      disabled={!!busy}
                      onClick={() => {
                        if (!phone || phone.length < 10) {
                          setShowPhoneModal(plan.id);
                        } else {
                          void handleCheckout(plan.id, phone);
                        }
                      }}
                    >
                      <Zap size={15} />
                      <span>Upgrade to {plan.name}</span>
                    </Button>
                  )}
                  <small className="plan-tax-note">
                    {isFree
                      ? "Free forever. Upgrade anytime."
                      : "All prices in INR. Inclusive of all taxes."}
                  </small>
                </div>
              </div>

              {/* Feature List */}
              <div className="plan-features-section">
                <div className="plan-features-label">WHAT&apos;S INCLUDED:</div>
                <ul className="plan-features-list">
                  {details.features.map((feat, idx) => (
                    <li
                      key={idx}
                      className={feat.highlight ? "feature-item-highlight" : "feature-item"}
                    >
                      <span className="feature-check-icon">
                        <Check size={12} strokeWidth={2.5} />
                      </span>
                      <span className="feature-text">
                        {feat.text}
                        {feat.tag && (
                          <span className={`feature-tag-inline ${getFeatureTagClass(feat.tag)}`}>
                            {feat.tag}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          );
        })}
      </div>

      {/* Phone Number Modal for Instant Checkout */}
      {showPhoneModal && (
        <div className="checkout-modal-backdrop" onClick={() => setShowPhoneModal(null)}>
          <div
            className="panel checkout-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-icon-badge">
                <ShieldCheck size={24} className="text-teal" />
              </div>
              <h3>Complete your {showPhoneModal.toUpperCase()} Plan</h3>
              <p>
                Enter your mobile number for the Cashfree payment receipt (UPI, Google Pay,
                PhonePe, NetBanking, Cards).
              </p>
            </div>

            <div className="form-group-phone">
              <label htmlFor="checkout-phone-input">Mobile Number (India)</label>
              <div className="phone-input-wrap">
                <span className="phone-prefix">+91</span>
                <input
                  id="checkout-phone-input"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel-national"
                  autoFocus
                  placeholder="9876543210"
                  maxLength={10}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                />
              </div>
              <small className="form-help-text">
                Required by RBI payment guidelines for OTP / payment link.
              </small>
            </div>

            <div className="modal-actions">
              <Button
                variant="secondary"
                onClick={() => setShowPhoneModal(null)}
                disabled={!!busy}
              >
                Cancel
              </Button>
              <Button
                className="plan-button-popular"
                busy={busy === showPhoneModal}
                disabled={phone.length > 0 && phone.length < 10}
                onClick={() => {
                  void handleCheckout(showPhoneModal, phone);
                }}
              >
                Proceed to Payment <ArrowRight size={16} />
              </Button>
            </div>

            <div className="modal-security-footer">
              <Lock size={13} />
              <span>256-Bit SSL Encrypted & Powered by Cashfree Payments</span>
            </div>
          </div>
        </div>
      )}

      {/* Footnote & Guarantee */}
      <div className="panel billing-trust-strip">
        <div className="trust-item">
          <ShieldCheck size={20} className="text-teal" />
          <div>
            <strong>Instant Activation</strong>
            <p>Minutes are added to your account as soon as checkout completes.</p>
          </div>
        </div>
        <div className="trust-item">
          <Zap size={20} className="text-teal" />
          <div>
            <strong>Cashfree Secure Payments</strong>
            <p>Pay via UPI, QR, Google Pay, PhonePe, Cards, or NetBanking.</p>
          </div>
        </div>
        <div className="trust-item">
          <Brain size={20} className="text-teal" />
          <div>
            <strong>AI &quot;Think&quot; Mode &amp; Knowledge Base</strong>
            <p>Full access to context uploads, resume grounding, and reasoning.</p>
          </div>
        </div>
      </div>

      <p className="billing-footnote">
        Payments are securely processed via Cashfree (UPI, Cards, NetBanking, Wallets).
        Minutes stay available until used and do not expire.
      </p>
    </div>
  );
}
