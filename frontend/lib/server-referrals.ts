import type { SupabaseClient } from "@supabase/supabase-js";
import { REFERRAL_WINDOW_MS, availableSpins, friendsToNextSpin, isReferralCode, pickPrize, referralCodeFor } from "./referrals";

type Profile = Record<string, unknown>;

export type ReferralUserRow = { id: string; profile?: Profile | null; credit_seconds?: number | null; created_at?: string | null };
export type ReferralReward = { minutes: number; at: string };
export type ReferralStatus = { code: string; verified_referrals: number; spins_used: number; spins_available: number; friends_to_next_spin: number; rewards: ReferralReward[] };

const profileOf = (row: ReferralUserRow): Profile => (row.profile && typeof row.profile === "object" ? row.profile : {});
const rewardsOf = (profile: Profile): ReferralReward[] => (Array.isArray(profile.referral_rewards) ? profile.referral_rewards.filter((item): item is ReferralReward => !!item && typeof item === "object" && typeof (item as ReferralReward).minutes === "number").slice(-50) : []);

/** The user's invite code, created and saved on first use. */
export async function ensureReferralCode(db: SupabaseClient, row: ReferralUserRow): Promise<string> {
  const profile = profileOf(row);
  if (isReferralCode(profile.referral_code)) return profile.referral_code;
  const code = referralCodeFor(row.id);
  await db.from("users").update({ profile: { ...profile, referral_code: code } }).eq("id", row.id);
  return code;
}

export async function verifiedReferralCount(db: SupabaseClient, referrerId: string): Promise<number> {
  const { count } = await db.from("users").select("id", { count: "exact", head: true }).eq("profile->>referred_by", referrerId);
  return count ?? 0;
}

export async function referralStatus(db: SupabaseClient, row: ReferralUserRow): Promise<ReferralStatus> {
  const code = await ensureReferralCode(db, row);
  const profile = profileOf(row);
  const verified = await verifiedReferralCount(db, row.id);
  const used = Number(profile.referral_spins_used) || 0;
  return { code, verified_referrals: verified, spins_used: used, spins_available: availableSpins(verified, used), friends_to_next_spin: friendsToNextSpin(verified, used), rewards: rewardsOf(profile) };
}

export type AttachResult = "attached" | "already_referred" | "invalid_code" | "self_referral" | "not_verified" | "not_new";

/**
 * Credit a new, verified account to the friend who invited it. Only accounts created within the
 * referral window count, so existing users cannot be farmed into someone's referral total.
 */
export async function attachReferral(db: SupabaseClient, friend: ReferralUserRow, code: unknown, check: { verified: boolean; accountCreatedAt: string | null | undefined; now?: number }): Promise<AttachResult> {
  if (!isReferralCode(code)) return "invalid_code";
  const profile = profileOf(friend);
  if (typeof profile.referred_by === "string" && profile.referred_by) return "already_referred";
  if (!check.verified) return "not_verified";
  const created = Date.parse(check.accountCreatedAt || "");
  if (!Number.isFinite(created) || (check.now ?? Date.now()) - created > REFERRAL_WINDOW_MS) return "not_new";
  const { data: referrer } = await db.from("users").select("id").eq("profile->>referral_code", code).limit(1).maybeSingle();
  if (!referrer) return "invalid_code";
  if (referrer.id === friend.id) return "self_referral";
  await db.from("users").update({ profile: { ...profile, referred_by: referrer.id, referred_at: new Date(check.now ?? Date.now()).toISOString() } }).eq("id", friend.id);
  return "attached";
}

export type SpinResult = { ok: true; minutes: number; status: ReferralStatus } | { ok: false; reason: "no_spins" | "busy" };

/** The server picks the prize; the wheel only animates to it. One spin per call, guarded against double claims. */
export async function claimSpin(db: SupabaseClient, row: ReferralUserRow, random: number): Promise<SpinResult> {
  const before = await referralStatus(db, row);
  if (before.spins_available <= 0) return { ok: false, reason: "no_spins" };
  const minutes = pickPrize(random);
  const profile = profileOf(row);
  const credit = Number(row.credit_seconds) || 0;
  const nextProfile = { ...profile, referral_code: before.code, referral_spins_used: before.spins_used + 1, referral_rewards: [...before.rewards, { minutes, at: new Date().toISOString() }] };
  // Optimistic lock: a concurrent spin changes credit_seconds, so only one of two simultaneous claims lands.
  const { data } = await db.from("users").update({ profile: nextProfile, credit_seconds: credit + minutes * 60 }).eq("id", row.id).eq("credit_seconds", credit).select("id").maybeSingle();
  if (!data) return { ok: false, reason: "busy" };
  return { ok: true, minutes, status: { ...before, spins_used: before.spins_used + 1, spins_available: before.spins_available - 1, friends_to_next_spin: friendsToNextSpin(before.verified_referrals, before.spins_used + 1), rewards: nextProfile.referral_rewards } };
}
