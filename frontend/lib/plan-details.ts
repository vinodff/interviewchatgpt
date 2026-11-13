import type { PaidPlanId } from "./plans";

export interface PlanFeature {
  text: string;
  tag?: string;
}

export interface PlanDetail {
  tagline: string;
  /** One short line under the minutes that makes the allowance concrete. */
  highlight: string;
  cta: string;
  /** Headline badge: the plan we steer people towards. Only one plan should have it. */
  badge?: string;
  /** Small secondary label, e.g. the cheapest per-minute pack. */
  ribbon?: string;
}

/** Card copy per paid pack. Every pack unlocks the same features; only the minutes differ. */
export const PLAN_DETAILS: Record<PaidPlanId, PlanDetail> = {
  starter: {
    tagline: "Try it on your next real interview.",
    highlight: "Enough for one focused round",
    cta: "Get 20 minutes",
  },
  pro: {
    tagline: "A full hour of help across your whole interview loop.",
    highlight: "One full hour, 3× the Starter pack",
    cta: "Get 60 minutes",
    badge: "Most popular",
  },
  value: {
    tagline: "For an active job hunt with many interviews.",
    highlight: "Two and a half hours of live help",
    cta: "Get 150 minutes",
    ribbon: "Lowest per minute",
  },
};

/** Shown on every card. Only list features the product actually ships to every paid user. */
export const INCLUDED_FEATURES: readonly PlanFeature[] = [
  { text: "Real-time answers while the interviewer speaks" },
  { text: "Hears you and the interviewer (mic + tab audio on desktop)" },
  { text: "Answers grounded in your resume and projects" },
  { text: "Knowledge base for job descriptions and company notes" },
  { text: "Think mode for harder technical questions", tag: "Think" },
  { text: "Role presets: SWE, System Design, PM, Behavioral" },
  { text: "STAR-structured behavioural answers" },
  { text: "Minutes never expire", tag: "No expiry" },
];
