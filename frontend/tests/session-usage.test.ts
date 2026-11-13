import { describe, expect, it } from "vitest";
import { MAX_BILLED_GAP_SECONDS, billableSeconds, chargeSession } from "@/lib/session-usage";

type Row = Record<string, unknown>;

/** Minimal Supabase-style query builder over in-memory tables. */
function fakeDb(tables: Record<string, Row[]>) {
  return {
    tables,
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let patch: Row | null = null;
      const rows = () => (tables[table] ||= []).filter(row => filters.every(([key, value]) => row[key] === value));
      const builder = {
        select: () => builder,
        eq: (key: string, value: unknown) => { filters.push([key, value]); return builder; },
        update: (values: Row) => { patch = values; return builder; },
        insert: async (values: Row) => { (tables[table] ||= []).push({ ...values }); return { data: null, error: null }; },
        maybeSingle: async () => {
          const found = rows();
          if (patch) found.forEach(row => Object.assign(row, patch));
          return { data: found[0] ?? null, error: null };
        },
        then: (resolve: (value: { data: null; error: null }) => void) => {
          if (patch) rows().forEach(row => Object.assign(row, patch));
          resolve({ data: null, error: null });
        },
      };
      return builder;
    },
  };
}

const MONTH = new Date().toISOString().slice(0, 7);

describe("billableSeconds", () => {
  it("bills the real gap between heartbeats", () => {
    expect(billableSeconds(1_000, 11_000)).toBe(10);
  });
  it("never bills more than one capped gap, so a sleeping tab is not overcharged", () => {
    expect(billableSeconds(0, 600_000)).toBe(MAX_BILLED_GAP_SECONDS);
  });
  it("bills nothing for clock skew or a missing watermark", () => {
    expect(billableSeconds(20_000, 10_000)).toBe(0);
    expect(billableSeconds(Number.NaN, 10_000)).toBe(0);
  });
});

describe("chargeSession", () => {
  const started = Date.parse("2026-11-14T10:00:00.000Z");

  it("adds the elapsed seconds to this month's usage and moves the watermark", async () => {
    const db = fakeDb({ live_sessions: [{ id: "s1", status: "created", billed_seconds: 0, metrics: {}, created_at: new Date(started).toISOString() }], usage_buckets: [] });
    const result = await chargeSession(db as never, db.tables.live_sessions[0] as never, "u1", started + 12_000);
    expect(result.charged).toBe(12);
    expect(db.tables.usage_buckets).toEqual([{ user_id: "u1", month: MONTH, seconds: 12 }]);
    expect(db.tables.live_sessions[0]).toMatchObject({ billed_seconds: 12, status: "live", metrics: { last_billed_at: started + 12_000 } });

    await chargeSession(db as never, db.tables.live_sessions[0] as never, "u1", started + 22_000);
    expect(db.tables.usage_buckets[0].seconds).toBe(22);
    expect(db.tables.live_sessions[0].billed_seconds).toBe(22);
  });

  it("never charges an ended session", async () => {
    const db = fakeDb({ live_sessions: [{ id: "s1", status: "ended", billed_seconds: 40, metrics: {}, created_at: new Date(started).toISOString() }], usage_buckets: [] });
    const result = await chargeSession(db as never, db.tables.live_sessions[0] as never, "u1", started + 60_000);
    expect(result.charged).toBe(0);
    expect(db.tables.usage_buckets).toEqual([]);
  });
});
