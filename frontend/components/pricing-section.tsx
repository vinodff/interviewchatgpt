import Link from "next/link";
import { ArrowRight, Check, Clock, Crown, ShieldCheck, Zap } from "lucide-react";
import { loadPlans } from "@/lib/server-plans";
import { PLAN_DETAILS, getFeatureTagClass } from "@/lib/plan-details";

export async function PricingSection({ full = false }: { full?: boolean }) {
  const catalog = await loadPlans();

  return (
    <section
      className={`pricing-section landing-container ${full ? "pricing-full" : ""}`}
      id="pricing"
      aria-label="Interview plans"
    >
      {!full && (
        <div className="landing-section-heading" data-reveal>
          <p className="eyebrow">SIMPLE TRANSPARENT PLANS</p>
          <h2>Start free. Choose more time.</h2>
          <p>Four flexible plans tailored for every stage of your interview journey.</p>
        </div>
      )}

      <div className="pricing-grid account-plan-grid-modern">
        {catalog.plans.map((plan, index) => {
          const details = PLAN_DETAILS[plan.id];
          const isPopular = plan.id === "pro";
          const isValue = plan.id === "value";
          const isStarter = plan.id === "starter";
          const isFree = plan.id === "free";

          const checkoutHref = isFree
            ? "/interview?view=live&signup=1"
            : `/interview?view=billing&plan=${plan.id}`;

          const buttonText = isFree
            ? "Start Free Interview"
            : isPopular
            ? "Upgrade to Popular"
            : isValue
            ? "Upgrade to Value"
            : "Get Starter";

          const buttonClass = isFree
            ? "plan-button-free"
            : isPopular
            ? "plan-button-popular"
            : isValue
            ? "plan-button-value"
            : "plan-button-starter";

          return (
            <article
              className={`panel account-plan-card account-plan-${plan.id} ${
                isPopular ? "account-plan-popular" : ""
              } ${isValue ? "account-plan-value" : ""} ${
                isStarter ? "account-plan-starter" : ""
              } ${isFree ? "account-plan-free" : ""}`}
              key={plan.id}
              data-reveal
              data-reveal-delay={index * 60}
            >
              {/* Top floating badge */}
              {details?.badge && (
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
                  <p className="plan-tagline">{details?.tagline}</p>
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

                <div className="plan-cta-box">
                  <Link
                    href={checkoutHref}
                    className={`plan-button-main ${buttonClass}`}
                  >
                    {!isFree && <Zap size={15} />}
                    <span>{buttonText}</span>
                    <ArrowRight size={15} />
                  </Link>
                  <small className="plan-tax-note">
                    {isFree
                      ? "No credit card required. Instant access."
                      : "All prices in INR. Inclusive of all taxes."}
                  </small>
                </div>
              </div>

              {/* Features section begins at the exact same vertical pixel */}
              {details?.features && (
                <div className="plan-features-section">
                  <div className="plan-features-label">WHAT&apos;S INCLUDED:</div>
                  <ul className="plan-features-list">
                    {details.features.map((feat, idx) => (
                      <li
                        key={idx}
                        className={
                          feat.highlight ? "feature-item-highlight" : "feature-item"
                        }
                      >
                        <span className="feature-check-icon">
                          <Check size={12} strokeWidth={2.5} />
                        </span>
                        <span className="feature-text">
                          {feat.text}
                          {feat.tag && (
                            <span
                              className={`feature-tag-inline ${getFeatureTagClass(
                                feat.tag
                              )}`}
                            >
                              {feat.tag}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </article>
          );
        })}
      </div>

      <p className="pricing-note">
        <ShieldCheck size={16} />
        All plans and services are priced in Indian Rupees (INR) and are inclusive of all applicable taxes.
        Transactions are secured and processed via Cashfree Payments India Pvt. Ltd. with instant digital service delivery.
      </p>

      {!full && (
        <Link href="/plans" className="landing-secondary">
          Compare all plans <ArrowRight size={16} />
        </Link>
      )}
    </section>
  );
}
