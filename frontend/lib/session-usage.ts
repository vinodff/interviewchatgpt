import type { SupabaseClient } from "@supabase/supabase-js";
import { currentMonthKey } from "./supabase-server";

/**
 * Longest gap one heartbeat may bill. The client pings about every 10 s; a tab that slept or
 * lost its connection is not charged for the time it was away.
 */
export const MAX_BILLED_GAP_SECONDS = 30;

export type BillableSession = {
  id: string;
  status: string;
  billed_seconds?: number | null;
  metrics?: Record<string, unknown> | null;
  created_at: string;
};

/** Whole seconds to bill between the last billed moment and now, measured on the server clock. */
export function billableSeconds(lastBilledAtMs: number, nowMs: number, cap = MAX_BILLED_GAP_SECONDS): number {
  if (!Number.isFinite(lastBilledAtMs) || nowMs <= lastBilledAtMs) return 0;
  return Math.min(cap, Math.round((nowMs - lastBilledAtMs) / 1000));
}

/** Add seconds to the user's usage for the current month (one row per user per month). */
export async function addUsageSeconds(db: SupabaseClient, userId: string, seconds: number): Promise<void> {
  if (seconds <= 0) return;
  const month = currentMonthKey();
  const { data } = await db.from("usage_buckets").select("seconds").eq("user_id", userId).eq("month", month).maybeSingle();
  if (data) await db.from("usage_buckets").update({ seconds: (Number(data.seconds) || 0) + seconds }).eq("user_id", userId).eq("month", month);
  else await db.from("usage_buckets").insert({ user_id: userId, month, seconds });
}

/**
 * Bill a live session up to now and record the new watermark on the session.
 * `usageUserId` is the app user row id that usage buckets are keyed by.
 */
export async function chargeSession(db: SupabaseClient, session: BillableSession, usageUserId: string, nowMs = Date.now()): Promise<{ charged: number; session: BillableSession }> {
  if (session.status === "ended") return { charged: 0, session };
  const metrics = session.metrics && typeof session.metrics === "object" ? session.metrics : {};
  const last = typeof metrics.last_billed_at === "number" ? metrics.last_billed_at : Date.parse(session.created_at);
  const charged = billableSeconds(last, nowMs);
  // Move the watermark even when nothing is billed, so a long pause is skipped exactly once.
  const next = { billed_seconds: (Number(session.billed_seconds) || 0) + charged, metrics: { ...metrics, last_billed_at: nowMs }, status: "live" };
  const { data } = await db.from("live_sessions").update(next).eq("id", session.id).select().maybeSingle();
  await addUsageSeconds(db, usageUserId, charged);
  return { charged, session: (data as BillableSession | null) ?? { ...session, ...next } };
}
