import type { ReactNode } from "react";
import { Check, Sparkles, Zap } from "lucide-react";
import { formatPlanPrice, perMinuteLabel, savingsVsStarter, starterRatePrice, type PaidPlanId, type Plan } from "@/lib/plans";
import { INCLUDED_FEATURES, PLAN_DETAILS } from "@/lib/plan-details";
import "./pricing.css";

interface PlanCardProps {
  plan: Plan & { id: PaidPlanId };
  /** The buy control: a link on marketing pages, a checkout button inside the app. */
  action: ReactNode;
  selected?: boolean;
}

/** One paid minute pack. Presentational only, so it renders on the server and inside client components. */
export function PlanCard({ plan, action, selected = false }: PlanCardProps) {
  const details = PLAN_DETAILS[plan.id];
  const rate = perMinuteLabel(plan.amount, plan.minutes);
  const saving = savingsVsStarter(plan.id);
  const anchor = starterRatePrice(plan.amount, plan.minutes);
  const classes = [
    "pc-card",
    details.badge ? "pc-card--popular" : "",
    selected ? "pc-card--selected account-plan-selected" : "",
  ];

  return (
    <article className={classes.filter(Boolean).join(" ")} aria-labelledby={`plan-${plan.id}-name`}>
      {details.badge && (
        <span className="pc-badge"><Sparkles size={13} aria-hidden="true" /> {details.badge}</span>
      )}

      <div className="pc-title-row">
        <h3 className="pc-name" id={`plan-${plan.id}-name`}>{plan.name}</h3>
        {details.ribbon && <span className="pc-ribbon">{details.ribbon}</span>}
      </div>
      <p className="pc-tagline">{details.tagline}</p>

      <div className="pc-price-row">
        {anchor && (
          <s className="pc-was">
            <span className="sr-only">Would cost </span>{formatPlanPrice(anchor * 100)}<span className="sr-only"> at the Starter rate, now</span>
          </s>
        )}
        <span className="pc-amount">{formatPlanPrice(plan.amount)}</span>
        {saving && <span className="pc-save">Save {saving}%</span>}
      </div>
      <p className="pc-terms">One-time payment · taxes included</p>

      <div className="pc-minutes-panel">
        <div>
          <p className="pc-minutes"><strong>{plan.minutes}</strong> minutes</p>
          <p className="pc-minutes-sub">{details.highlight}</p>
        </div>
        {rate && <span className="pc-rate">{rate}<small>/min</small></span>}
      </div>

      <div className="pc-action">{action}</div>
      <p className="pc-assure"><Zap size={13} aria-hidden="true" /> Added instantly · never expires</p>

      <hr className="pc-rule" />

      <p className="pc-included-label">Everything included</p>
      <ul className="pc-features">
        {INCLUDED_FEATURES.map(feature => (
          <li key={feature.text}>
            <span className="pc-check" aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
            <span>
              {feature.text}
              {feature.tag && <span className="pc-tag">{feature.tag}</span>}
            </span>
          </li>
        ))}
      </ul>
    </article>
  );
}
