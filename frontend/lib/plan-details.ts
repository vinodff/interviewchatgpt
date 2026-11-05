import type { PlanId } from "./plans";

export interface PlanFeatureItem {
  text: string;
  highlight?: boolean;
  tag?: string;
}

export interface PlanDetail {
  tagline: string;
  badge?: string;
  badgeColor?: string;
  features: PlanFeatureItem[];
}

export function getFeatureTagClass(tag?: string): string {
  if (!tag) return "";
  switch (tag.toLowerCase()) {
    case "resume":
      return "feature-tag-blue";
    case "knowledge":
      return "feature-tag-amber";
    case "think":
      return "feature-tag-purple";
    case "unlimited":
      return "feature-tag-emerald";
    case "never expire":
      return "feature-tag-rose";
    default:
      return "feature-tag-default";
  }
}

export const PLAN_DETAILS: Record<PlanId, PlanDetail> = {
  free: {
    tagline: "Free tier to try live AI interview assistance.",
    badge: "FREE TIER",
    badgeColor: "#475569",
    features: [
      { text: "2 live interview minutes / month" },
      { text: "1 Resume upload & ATS keyword scanning" },
      { text: "Basic Knowledge Base (up to 3 documents)" },
      { text: "Real-time speech-to-text transcription" },
      { text: "Standard AI answer generation" },
      { text: "STAR method interview coaching" },
      { text: "Community & standard support" },
    ],
  },
  starter: {
    tagline: "Great for your upcoming 1–2 interview rounds.",
    badge: "QUICK PREP",
    badgeColor: "#2563eb",
    features: [
      { text: "20 live interview minutes", highlight: true },
      { text: "Unlimited Resume Uploads & Project Grounding", highlight: true, tag: "Resume" },
      { text: "Custom Knowledge Base (upload job descriptions, company briefs & notes)", highlight: true, tag: "Knowledge" },
      { text: "AI \"Think\" & Deep Reasoning Mode", highlight: true, tag: "Think" },
      { text: "Real-time STAR-method structured answers" },
      { text: "Dual audio capture (mic + interviewer voice)" },
      { text: "Fast Gemini 3.8 Flash inference" },
      { text: "Priority email support" },
    ],
  },
  pro: {
    tagline: "Recommended for active job seekers & complete interview loops.",
    badge: "★ MOST POPULAR",
    badgeColor: "#0f766e",
    features: [
      { text: "45 live interview minutes (covers 3–4 interview rounds)", highlight: true },
      { text: "Unlimited Knowledge Base & Company Research files", highlight: true, tag: "Unlimited" },
      { text: "Unlimited Resume Uploads & Versions (tailored per job role)", highlight: true, tag: "Resume" },
      { text: "Advanced AI \"Think\" & Strategy Engine (anticipates follow-up questions)", highlight: true, tag: "Think" },
      { text: "Multi-Turn Interview Memory & Context Retention" },
      { text: "Role Presets: SWE, System Design, Behavioral, Frontend, Backend, PM" },
      { text: "Real-Time AI Whisper Suggestions & Code Snippet Hints" },
      { text: "Ultra-low latency streaming AI answers" },
      { text: "Priority 24/7 dedicated assistance" },
    ],
  },
  value: {
    tagline: "Full coverage for senior loops, executive rounds & intensive preparation.",
    badge: "💎 ULTIMATE VALUE",
    badgeColor: "#7c3aed",
    features: [
      { text: "120 live interview minutes (2 full hours of live AI assistance!)", highlight: true },
      { text: "Permanent validity — purchased minutes never expire", highlight: true, tag: "Never Expire" },
      { text: "Full Unlimited Knowledge Base & Resume Document Vault", highlight: true, tag: "Knowledge" },
      { text: "Deepest AI Reasoning (\"Think Max\") for Architecture, LeetCode & Trade-offs", highlight: true, tag: "Think" },
      { text: "Mock Interview History & Post-Session Performance Reports" },
      { text: "Staff / Principal / Engineering Manager specialized presets" },
      { text: "Guaranteed zero-queue priority model access" },
      { text: "VIP direct onboarding & concierge support" },
    ],
  },
};
