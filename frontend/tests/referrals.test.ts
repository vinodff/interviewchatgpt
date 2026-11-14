import { describe, expect, it } from "vitest";
import { MAX_SPINS, SPIN_PRIZES, TOP_PRIZE_MINUTES, availableSpins, friendsToNextSpin, isReferralCode, odds, pickPrize, referralCodeFor } from "@/lib/referrals";

describe("spin prizes", () => {
  it("follows the published weights exactly", () => {
    expect(pickPrize(0)).toBe(1);
    expect(pickPrize(0.299)).toBe(1);
    expect(pickPrize(0.3)).toBe(2);
    expect(pickPrize(0.699)).toBe(2);
    expect(pickPrize(0.7)).toBe(3);
    expect(pickPrize(0.8989)).toBe(3);
    expect(pickPrize(0.9)).toBe(4);
    expect(pickPrize(0.9989)).toBe(4);
    expect(pickPrize(0.9991)).toBe(100);
    expect(pickPrize(0.99999)).toBe(100);
  });
  it("never awards a prize that is not on the wheel, even for bad random input", () => {
    const allowed = new Set(SPIN_PRIZES.map(prize => prize.minutes));
    for (const value of [-1, 1, 2, Number.NaN, 0.5]) expect(allowed.has(pickPrize(value))).toBe(true);
  });
  it("makes 100 minutes a real 1-in-1,000 top prize and keeps the average near 2 minutes", () => {
    const total = SPIN_PRIZES.reduce((sum, prize) => sum + prize.weight, 0);
    const average = SPIN_PRIZES.reduce((sum, prize) => sum + prize.minutes * prize.weight, 0) / total;
    expect(total).toBe(1000);
    expect(SPIN_PRIZES.find(prize => prize.minutes === 100)?.weight).toBe(1);
    expect(Math.max(...SPIN_PRIZES.map(prize => prize.minutes))).toBe(TOP_PRIZE_MINUTES);
    expect(average).toBeCloseTo(2.197, 3);
  });
  it("describes the published odds for the Terms page", () => {
    expect(odds()).toBe("1 min 30% · 2 min 40% · 3 min 19.9% · 4 min 10% · 100 min 0.1%");
  });
});

describe("spins earned", () => {
  it("gives one spin per 5 verified friends, minus spins used", () => {
    expect(availableSpins(4, 0)).toBe(0);
    expect(availableSpins(5, 0)).toBe(1);
    expect(availableSpins(12, 1)).toBe(1);
    expect(availableSpins(12, 2)).toBe(0);
  });
  it("is capped for life", () => {
    expect(availableSpins(500, 0)).toBe(MAX_SPINS);
    expect(availableSpins(500, MAX_SPINS)).toBe(0);
  });
  it("tells the user how many friends are left for the next spin", () => {
    expect(friendsToNextSpin(0, 0)).toBe(5);
    expect(friendsToNextSpin(3, 0)).toBe(2);
    expect(friendsToNextSpin(5, 0)).toBe(0);
    expect(friendsToNextSpin(5, 1)).toBe(5);
    expect(friendsToNextSpin(7, 1)).toBe(3);
  });
});

describe("invite codes", () => {
  it("are stable, short and URL-safe", () => {
    const code = referralCodeFor("2b1f4c7e-1234-4a6b-9c0d-abcdef012345");
    expect(code).toBe(referralCodeFor("2b1f4c7e-1234-4a6b-9c0d-abcdef012345"));
    expect(isReferralCode(code)).toBe(true);
    expect(code).not.toBe(referralCodeFor("another-user"));
  });
  it("rejects anything that is not a code", () => {
    for (const value of ["", "abc", "<script>", "TOOLONGCODE12345", 42, null]) expect(isReferralCode(value)).toBe(false);
  });
});
