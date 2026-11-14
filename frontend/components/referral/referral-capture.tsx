"use client";

import { useEffect } from "react";
import { isReferralCode } from "@/lib/referrals";

export const REFERRAL_STORAGE_KEY = "iw_ref";

/** Remembers an invite code from ?ref=CODE so it can be credited once the visitor signs up. */
export function ReferralCapture() {
  useEffect(() => {
    try {
      const code = new URLSearchParams(window.location.search).get("ref")?.toUpperCase();
      if (isReferralCode(code) && !window.localStorage.getItem(REFERRAL_STORAGE_KEY)) window.localStorage.setItem(REFERRAL_STORAGE_KEY, code);
    } catch { /* Storage can be blocked; the visitor can still sign up normally. */ }
  }, []);
  return null;
}
