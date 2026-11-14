/** Referral spin and milestone rules. Pure functions: shared by the server (which decides) and the UI (which shows). */

export const REFERRALS_PER_SPIN = 5;
/** Lifetime cap, so referral rewards stay a bonus rather than a free plan. */
export const MAX_SPINS = 10;
/** A friend counts only if they sign up within this window of creating their account. */
export const REFERRAL_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Prize odds, in spins per 1,000. Every prize on the wheel can really be won: about 1 spin in 1,000
 * wins the 100-minute top prize, the rest win 1-4 minutes. The odds are published on the Terms page.
 */
export const SPIN_PRIZES: ReadonlyArray<{ minutes: number; weight: number }> = [
  { minutes: 1, weight: 300 },
  { minutes: 2, weight: 400 },
  { minutes: 3, weight: 199 },
  { minutes: 4, weight: 100 },
  { minutes: 100, weight: 1 },
];

export const TOP_PRIZE_MINUTES = 100;

/** Map a uniform random number in [0, 1) to a prize (in minutes) using the published weights. */
export function pickPrize(random: number): number {
  const total = SPIN_PRIZES.reduce((sum, prize) => sum + prize.weight, 0);
  let point = Math.min(Math.max(random, 0), 0.999999999) * total;
  for (const prize of SPIN_PRIZES) {
    if (point < prize.weight) return prize.minutes;
    point -= prize.weight;
  }
  return SPIN_PRIZES[SPIN_PRIZES.length - 1].minutes;
}

/** Spins a user can claim now: one per 5 verified friends, capped, minus spins already used. */
export function availableSpins(verifiedReferrals: number, spinsUsed: number): number {
  const earned = Math.min(Math.floor(Math.max(0, verifiedReferrals) / REFERRALS_PER_SPIN), MAX_SPINS);
  return Math.max(0, earned - Math.max(0, spinsUsed));
}

/** Friends still needed for the next spin (0 when a spin is ready). */
export function friendsToNextSpin(verifiedReferrals: number, spinsUsed: number): number {
  if (availableSpins(verifiedReferrals, spinsUsed) > 0) return 0;
  if (spinsUsed >= MAX_SPINS) return 0;
  return REFERRALS_PER_SPIN - (Math.max(0, verifiedReferrals) % REFERRALS_PER_SPIN || 0) || REFERRALS_PER_SPIN;
}

/** Stable, short, URL-safe invite code derived from the user id. */
export function referralCodeFor(userId: string): string {
  let hash = 2166136261;
  for (let i = 0; i < userId.length; i++) hash = Math.imul(hash ^ userId.charCodeAt(i), 16777619);
  let second = 5381;
  for (let i = 0; i < userId.length; i++) second = Math.imul(second, 33) ^ userId.charCodeAt(i);
  return ((hash >>> 0).toString(36) + (second >>> 0).toString(36)).toUpperCase().slice(0, 8).padEnd(8, "X");
}

export function isReferralCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z0-9]{6,12}$/.test(value);
}

export function odds(): string {
  const total = SPIN_PRIZES.reduce((sum, prize) => sum + prize.weight, 0);
  return SPIN_PRIZES.map(prize => `${prize.minutes} min ${Math.round((prize.weight / total) * 1000) / 10}%`).join(" · ");
}
