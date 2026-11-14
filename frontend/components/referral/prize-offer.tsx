import Link from "next/link";
import { ArrowRight, Gift, Trophy } from "lucide-react";
import { TOP_PRIZE_MINUTES } from "@/lib/referrals";
import "./referral.css";

const INVITE_HREF = "/interview?view=billing";

/** Slim offer bar at the very top of the website. */
export function PrizeOfferBar() {
  return (
    <Link href={INVITE_HREF} className="rf-topbar">
      <span className="rf-topbar-inner">
        <Gift size={15} aria-hidden="true" />
        <span><strong>Spin to win up to {TOP_PRIZE_MINUTES} free minutes</strong><span className="rf-topbar-sep" aria-hidden="true">·</span></span>
        <span className="rf-topbar-spin">Invite 5 friends to unlock your spin</span>
        <ArrowRight size={15} aria-hidden="true" />
      </span>
    </Link>
  );
}

/** Offer card for the pricing section. */
export function PrizeOfferCard() {
  return (
    <Link href={INVITE_HREF} className="rf-milestone rf-milestone--link" aria-label={`Invite 5 friends and spin to win up to ${TOP_PRIZE_MINUTES} free minutes`}>
      <span className="rf-milestone-icon"><Trophy size={20} aria-hidden="true" /></span>
      <span className="rf-milestone-body">
        <span className="rf-milestone-title">Spin to win up to <strong>{TOP_PRIZE_MINUTES} free minutes</strong></span>
        <span className="rf-milestone-meta">Invite 5 friends to unlock a spin · Terms apply</span>
      </span>
      <ArrowRight size={18} aria-hidden="true" className="rf-milestone-arrow" />
    </Link>
  );
}
