import Link from "next/link";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { loadPlans } from "@/lib/server-plans";
import { formatPlanPrice } from "@/lib/plans";

const descriptions: Record<string, string> = {
  free: "Try live interview assistance.",
  starter: "More time for your next few interviews.",
  pro: "For an active interview schedule.",
  value: "Comprehensive support for full interview loops.",
};

export async function PricingSection({ full = false }: { full?: boolean }) {
  const catalog = await loadPlans();
  return <section className={`pricing-section landing-container ${full ? "pricing-full" : ""}`} id="pricing" aria-label="Interview plans">
    {!full && <div className="landing-section-heading" data-reveal><p className="eyebrow">SIMPLE MONTHLY PLANS</p><h2>Start free. Choose more time.</h2><p>Three plans. The same helpful interview tools.</p></div>}
    <div className="pricing-grid">{catalog.plans.map((plan, index) => <article className={`pricing-card ${plan.id === "starter" ? "pricing-featured" : ""}`} key={plan.id} data-reveal data-reveal-delay={index * 60}>
      <div className="pricing-card-heading"><h2>{plan.name}</h2>{plan.id === "starter" && <span>More time to prepare</span>}</div>
      <p>{descriptions[plan.id]}</p><div className="pricing-amount">{formatPlanPrice(plan.amount)}<span>{plan.id === "free" ? "forever" : "/ month (INR)"}</span></div>
      <p className="pricing-minutes"><strong>{plan.minutes} live minutes</strong> per calendar month</p>
      <ul><li><Check size={17} />Live answer suggestions</li><li><Check size={17} />Resume and project context</li><li><Check size={17} />Your preferred answer style</li><li><Check size={17} />Adjustable reading options</li></ul>
      <Link href={plan.id === "free" ? "/interview?view=live&signup=1" : `/interview?view=billing&plan=${plan.id}`} className={`button ${plan.id === "starter" ? "button-primary" : "button-secondary"}`}>{plan.id === "free" ? "Start free interview" : "Get Started"}<ArrowRight size={16} /></Link>
      <small>{plan.id === "free" ? "No credit card required for the Free plan." : "All prices in Indian Rupees (INR). Inclusive of all taxes."}</small>
    </article>)}</div>
    <p className="pricing-note"><ShieldCheck size={16} />All plans and services are priced in Indian Rupees (INR) and are inclusive of all applicable taxes. Transactions are secured and processed via Cashfree Payments India Pvt. Ltd. with instant digital service delivery.</p>
    {!full && <Link href="/plans" className="landing-secondary">Compare all plans <ArrowRight size={16} /></Link>}
  </section>;
}
