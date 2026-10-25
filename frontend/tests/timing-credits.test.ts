import { describe, expect, it } from "vitest";
import { userShape, type UserRow } from "../lib/supabase-server";

describe("plan minutes and free trial timing calculation", () => {
  const makeMockDb = (secondsUsed: number) => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { seconds: secondsUsed } }),
          }),
        }),
      }),
    }),
  });

  it("gives brand new free user 2 minutes free trial", async () => {
    const mockDb = makeMockDb(0);
    const row: UserRow = {
      id: "usr_1",
      email: "test@example.com",
      name: "Test User",
      plan: "free",
      github_username: "",
      github_verified_id: null,
      github_verified_username: "",
      profile: {},
      preferences: {},
      stripe_customer_id: null,
      cf_customer_id: null,
      credit_seconds: 0,
    };

    const user = await userShape(mockDb as any, row);
    expect(user.minute_limit).toBe(2);
    expect(user.minutes_used).toBe(0);
    expect((user.minute_limit as number) - user.minutes_used).toBe(2);
    expect(user.credit_minutes_remaining).toBe(2);
  });

  it("shows 0 minutes remaining after user uses the 2 minute free trial", async () => {
    const mockDb = makeMockDb(120); // 2 minutes used
    const row: UserRow = {
      id: "usr_1",
      email: "test@example.com",
      name: "Test User",
      plan: "free",
      github_username: "",
      github_verified_id: null,
      github_verified_username: "",
      profile: {},
      preferences: {},
      stripe_customer_id: null,
      cf_customer_id: null,
      credit_seconds: 0,
    };

    const user = await userShape(mockDb as any, row);
    expect(user.minute_limit).toBe(2);
    expect(user.minutes_used).toBe(2);
    expect((user.minute_limit as number) - user.minutes_used).toBe(0);
    expect(user.credit_minutes_remaining).toBe(0);
  });

  it("adds the full 20 minutes for Starter plan (total 22m), so after 2m free trial user gets 20m remaining instead of 18m", async () => {
    const mockDb = makeMockDb(120); // 2 minutes used during free trial
    const row: UserRow = {
      id: "usr_1",
      email: "test@example.com",
      name: "Test User",
      plan: "starter",
      github_username: "",
      github_verified_id: null,
      github_verified_username: "",
      profile: {},
      preferences: {},
      stripe_customer_id: null,
      cf_customer_id: null,
      credit_seconds: 1200, // 20 minutes purchased
    };

    const user = await userShape(mockDb as any, row);
    // Total limit = 2 free + 20 purchased = 22
    expect(user.minute_limit).toBe(22);
    expect(user.minutes_used).toBe(2);
    // Remaining is 22 - 2 = 20 (NOT 18!)
    expect((user.minute_limit as number) - user.minutes_used).toBe(20);
    expect(user.credit_minutes_remaining).toBe(20);
  });

  it("adds the full 45 minutes for Pro plan (total 47m), so after 2m free trial user gets 45m remaining", async () => {
    const mockDb = makeMockDb(120); // 2 minutes used during free trial
    const row: UserRow = {
      id: "usr_1",
      email: "test@example.com",
      name: "Test User",
      plan: "pro",
      github_username: "",
      github_verified_id: null,
      github_verified_username: "",
      profile: {},
      preferences: {},
      stripe_customer_id: null,
      cf_customer_id: null,
      credit_seconds: 2700, // 45 minutes purchased
    };

    const user = await userShape(mockDb as any, row);
    expect(user.minute_limit).toBe(47);
    expect(user.minutes_used).toBe(2);
    expect((user.minute_limit as number) - user.minutes_used).toBe(45);
    expect(user.credit_minutes_remaining).toBe(45);
  });

  it("adds the full 120 minutes for Value plan (total 122m), so after 2m free trial user gets 120m remaining", async () => {
    const mockDb = makeMockDb(120); // 2 minutes used during free trial
    const row: UserRow = {
      id: "usr_1",
      email: "test@example.com",
      name: "Test User",
      plan: "value",
      github_username: "",
      github_verified_id: null,
      github_verified_username: "",
      profile: {},
      preferences: {},
      stripe_customer_id: null,
      cf_customer_id: null,
      credit_seconds: 7200, // 120 minutes purchased
    };

    const user = await userShape(mockDb as any, row);
    expect(user.minute_limit).toBe(122);
    expect(user.minutes_used).toBe(2);
    expect((user.minute_limit as number) - user.minutes_used).toBe(120);
    expect(user.credit_minutes_remaining).toBe(120);
  });

  it("preserves unused free trial if user purchases before using free minutes (total 22m remaining)", async () => {
    const mockDb = makeMockDb(0); // 0 minutes used
    const row: UserRow = {
      id: "usr_1",
      email: "test@example.com",
      name: "Test User",
      plan: "starter",
      github_username: "",
      github_verified_id: null,
      github_verified_username: "",
      profile: {},
      preferences: {},
      stripe_customer_id: null,
      cf_customer_id: null,
      credit_seconds: 1200, // 20 minutes purchased
    };

    const user = await userShape(mockDb as any, row);
    expect(user.minute_limit).toBe(22);
    expect(user.minutes_used).toBe(0);
    expect((user.minute_limit as number) - user.minutes_used).toBe(22);
    expect(user.credit_minutes_remaining).toBe(22);
  });
});
