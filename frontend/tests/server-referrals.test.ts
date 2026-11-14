import { describe, expect, it } from "vitest";
import { attachReferral, claimSpin, referralStatus } from "@/lib/server-referrals";
import { referralCodeFor } from "@/lib/referrals";

type Row = Record<string, unknown>;

/** In-memory Supabase-style builder: eq (incl. `col->>key`), order, limit, count/head, select-after-update. */
function fakeDb(tables: Record<string, Row[]>) {
  const read = (row: Row, key: string) => {
    if (!key.includes("->>")) return row[key];
    const [column, field] = key.split("->>");
    const value = (row[column] as Row | undefined)?.[field];
    return value === undefined || value === null ? null : String(value);
  };
  return {
    tables,
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const notFilters: Array<[string, unknown]> = [];
      let patch: Row | null = null; let orderBy: [string, boolean] | null = null; let max = Infinity; let headCount = false;
      const matched = () => {
        let found = (tables[table] ||= []).filter(row => filters.every(([key, value]) => read(row, key) === value) && notFilters.every(([key, value]) => read(row, key) !== value));
        if (orderBy) { const [key, asc] = orderBy; found = [...found].sort((a, b) => (String(a[key]) < String(b[key]) ? -1 : 1) * (asc ? 1 : -1)); }
        return found.slice(0, max);
      };
      const run = () => { const found = matched(); if (patch) found.forEach(row => Object.assign(row, structuredClone(patch))); return found; };
      const builder = {
        select: (_cols?: string, options?: { count?: string; head?: boolean }) => { if (options?.head) headCount = true; return builder; },
        eq: (key: string, value: unknown) => { filters.push([key, value]); return builder; },
        not: (key: string, _op: string, value: unknown) => { notFilters.push([key, value]); return builder; },
        order: (key: string, options?: { ascending?: boolean }) => { orderBy = [key, options?.ascending !== false]; return builder; },
        limit: (value: number) => { max = value; return builder; },
        update: (values: Row) => { patch = values; return builder; },
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => void) => { const found = run(); resolve(headCount ? { count: found.length, data: null, error: null } : { data: found, error: null }); },
      };
      return builder;
    },
  };
}

const now = Date.parse("2026-11-14T12:00:00.000Z");
const user = (id: string, profile: Row = {}, extra: Row = {}): Row => ({ id, profile, credit_seconds: 0, created_at: new Date(now - 3600_000).toISOString(), ...extra });

describe("referrals", () => {
  it("credits a verified new friend to the inviter and counts them", async () => {
    const db = fakeDb({ users: [user("alice"), user("bob")] });
    const alice = db.tables.users[0];
    const status = await referralStatus(db as never, alice as never);
    expect(status).toMatchObject({ code: referralCodeFor("alice"), verified_referrals: 0, spins_available: 0, friends_to_next_spin: 5 });
    const result = await attachReferral(db as never, db.tables.users[1] as never, status.code, { verified: true, accountCreatedAt: db.tables.users[1].created_at as string, now });
    expect(result).toBe("attached");
    expect((await referralStatus(db as never, alice as never)).verified_referrals).toBe(1);
  });
  it("refuses self-referrals, unverified, old, already-referred accounts and bad codes", async () => {
    const db = fakeDb({ users: [user("alice", { referral_code: referralCodeFor("alice") }), user("old", {}, { created_at: "2026-01-01T00:00:00.000Z" }), user("taken", { referred_by: "someone" })] });
    const code = referralCodeFor("alice");
    const [alice, old, taken] = db.tables.users;
    expect(await attachReferral(db as never, alice as never, code, { verified: true, accountCreatedAt: alice.created_at as string, now })).toBe("self_referral");
    expect(await attachReferral(db as never, old as never, code, { verified: false, accountCreatedAt: old.created_at as string, now })).toBe("not_verified");
    expect(await attachReferral(db as never, old as never, code, { verified: true, accountCreatedAt: old.created_at as string, now })).toBe("not_new");
    expect(await attachReferral(db as never, taken as never, code, { verified: true, accountCreatedAt: taken.created_at as string, now })).toBe("already_referred");
    expect(await attachReferral(db as never, old as never, "<bad>", { verified: true, accountCreatedAt: old.created_at as string, now })).toBe("invalid_code");
  });
  it("gives one spin per 5 friends, adds the prize as minutes and cannot be claimed twice", async () => {
    const friends = Array.from({ length: 5 }, (_, i) => user(`f${i}`, { referred_by: "alice" }));
    const db = fakeDb({ users: [user("alice"), ...friends] });
    const alice = db.tables.users[0];
    const spin = await claimSpin(db as never, alice as never, 0.95);
    expect(spin).toMatchObject({ ok: true, minutes: 4 });
    expect(alice.credit_seconds).toBe(240);
    expect((alice.profile as Row).referral_spins_used).toBe(1);
    expect(await claimSpin(db as never, alice as never, 0.1)).toEqual({ ok: false, reason: "no_spins" });
    expect(alice.credit_seconds).toBe(240);
  });
  it("lets only one of two simultaneous spins land", async () => {
    const friends = Array.from({ length: 5 }, (_, i) => user(`f${i}`, { referred_by: "alice" }));
    const db = fakeDb({ users: [user("alice"), ...friends] });
    const stale = structuredClone(db.tables.users[0]);
    await claimSpin(db as never, db.tables.users[0] as never, 0.5);
    expect(await claimSpin(db as never, stale as never, 0.5)).toEqual({ ok: false, reason: "busy" });
  });
});

describe("top prize", () => {
  it("adds the full 100 minutes when the 1-in-1,000 top prize comes up", async () => {
    const friends = Array.from({ length: 5 }, (_, i) => user(`f${i}`, { referred_by: "alice" }));
    const db = fakeDb({ users: [user("alice"), ...friends] });
    const spin = await claimSpin(db as never, db.tables.users[0] as never, 0.9995);
    expect(spin).toMatchObject({ ok: true, minutes: 100 });
    expect(db.tables.users[0].credit_seconds).toBe(6000);
  });
});
