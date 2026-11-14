import Link from "next/link";
import { ArrowRight, ShieldCheck, Timer } from "lucide-react";
import { loadPlans } from "@/lib/server-plans";
import { PLAN_DETAILS } from "@/lib/plan-details";
import type { PaidPlanId, Plan } from "@/lib/plans";
import { PlanCard } from "./pricing/plan-card";
import { PrizeOfferCard } from "./referral/prize-offer";

function isPaid(plan: Plan): plan is Plan & { id: PaidPlanId } {
  return plan.id !== "free";
}

export async function PricingSection({ full = false }: { full?: boolean }) {
  const catalog = await loadPlans();
  const paidPlans = catalog.plans.filter(isPaid);
  const free = catalog.plans.find(plan => plan.id === "free");

  return (
    <section className="pricing-section pc-section landing-container" id="pricing" aria-label="Interview plans">
      {!full && (
        <div className="pc-head" data-reveal>
          <span className="pc-eyebrow"><Timer size={15} aria-hidden="true" /> Only connected time is billed</span>
          <h2>Pay once. <em>Use it when the call comes.</em></h2>
          <p>One-time minute packs. No subscription, no auto-renewal, and your minutes never expire.</p>
        </div>
      )}

      <div className="pc-grid">
        {paidPlans.map(plan => (
          <PlanCard
            key={plan.id}
            plan={plan}
            action={
              <Link href={`/interview?view=billing&plan=${plan.id}`} className="pc-button">
                {PLAN_DETAILS[plan.id].cta} <ArrowRight size={16} aria-hidden="true" />
              </Link>
            }
          />
        ))}
      </div>

      {free && (
        <div className="pc-free">
          <p><strong>Not ready to pay?</strong> Try every feature with {free.minutes} free live minutes each month. No card needed.</p>
          <Link href="/interview?view=live&signup=1" className="pc-free-link">Start free <ArrowRight size={15} aria-hidden="true" /></Link>
        </div>
      )}

      <PrizeOfferCard />

      <p className="pricing-note">
        <ShieldCheck size={16} aria-hidden="true" />
        Prices are in Indian Rupees and include all taxes. Payments are processed securely by Cashfree Payments India Pvt. Ltd., and minutes are added to your account as soon as payment is confirmed.
      </p>

      {!full && (
        <Link href="/plans" className="landing-secondary">
          See pricing questions <ArrowRight size={16} />
        </Link>
      )}
    </section>
  );
}
