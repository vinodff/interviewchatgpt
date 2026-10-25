import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { User } from "./types";

/**
 * Vercel + Supabase ONLY server layer, LOGIN FIRST.
 * There is no FastAPI backend, no Render/Docker host and no Redis here:
 * identity lives in the Supabase Postgres tables the backend used
 * (users, usage_buckets). Payments are OUT OF SCOPE for this build —
 * the existing GitHub Pages Cashfree bridge in billing.tsx is untouched,
 * and no Cashfree server route exists here.
 *
 * Required server env vars (never NEXT_PUBLIC_*, never in code):
 *   SUPABASE_SERVICE_ROLE_KEY — server-side DB access (bypasses RLS).
 *   NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY — the public
 *     Supabase project, already used by the browser client in lib/supabase.ts.
 *
 * A missing env var is reported by name with a 503, never as a generic
 * error, so the user knows exactly what to set in Vercel.
 */

export const PLAN_LIMITS: Record<string, number> = { free: 2, starter: 20, pro: 45, value: 120 };

export function currentMonthKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function supabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || "https://vcpvpzxytleafevindjb.supabase.co";
}

export class MissingEnvError extends Error {
  constructor(public varName: string) {
    super(`Missing server environment variable: ${varName}. Set it in Vercel project settings for Production, then redeploy.`);
    this.name = "MissingEnvError";
  }
}

export function serviceClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) throw new MissingEnvError("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(supabaseUrl(), key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function getServiceClientSafe(): SupabaseClient | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) return null;
  return createClient(supabaseUrl(), key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export type VerifiedAuthUser = { id: string; email: string; name: string };

/** Validate the caller's Supabase JWT via Supabase Auth (getUser). The token itself is never trusted as an identity claim. */
export async function verifySupabaseUser(request: Request): Promise<VerifiedAuthUser> {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) {
    const error = new Error("Sign in is required.");
    (error as Error & { status?: number }).status = 401;
    throw error;
  }
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) throw new MissingEnvError("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const client = createClient(supabaseUrl(), anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user || !data.user.email) {
    const denied = new Error("Your sign-in session is no longer valid. Please sign in again.");
    (denied as Error & { status?: number }).status = 401;
    throw denied;
  }
  const metadata = (data.user.user_metadata || {}) as Record<string, unknown>;
  const name =
    (typeof metadata.full_name === "string" && metadata.full_name) ||
    (typeof metadata.name === "string" && metadata.name) ||
    data.user.email.split("@")[0];
  return { id: data.user.id, email: data.user.email, name };
}

export type UserRow = {
  id: string; email: string; name: string; plan: string; github_username: string;
  github_verified_id: number | null; github_verified_username: string;
  profile: Record<string, unknown>; preferences: Record<string, unknown>;
  stripe_customer_id: string | null; cf_customer_id: string | null;
  credit_seconds?: number | null;
};

/** Find the users row by email, or create one (plan free) for a first-time Google sign-in. Keyed by the Supabase Auth user id. */
export async function findOrCreateUser(db: SupabaseClient, authUser: VerifiedAuthUser): Promise<UserRow> {
  const { data: byId } = await db.from("users").select("*").eq("id", authUser.id).maybeSingle();
  if (byId) return byId as UserRow;
  const { data: byEmail } = await db.from("users").select("*").eq("email", authUser.email).maybeSingle();
  if (byEmail) return byEmail as UserRow;
  const { data, error } = await db.from("users").insert({
    id: authUser.id, email: authUser.email, name: authUser.name, plan: "free",
    github_username: "", github_verified_username: "", profile: {}, preferences: {},
    credit_seconds: 0,
  }).select("*").single();
  if (error || !data) throw new Error("Could not load your account from Supabase. Please try again.");
  return data as UserRow;
}

export async function usedSeconds(db: SupabaseClient, userId: string): Promise<number> {
  const { data } = await db.from("usage_buckets").select("seconds").eq("user_id", userId).eq("month", currentMonthKey()).maybeSingle();
  return typeof data?.seconds === "number" ? data.seconds : 0;
}

/** The exact User shape the frontend expects (see lib/types.ts). */
export async function userShape(db: SupabaseClient, row: UserRow): Promise<User> {
  const seconds = await usedSeconds(db, row.id);
  const plan = PLAN_LIMITS[row.plan] !== undefined ? row.plan : "free";
  const freeTrialMinutes = PLAN_LIMITS.free || 2;
  const creditMinutes = Math.floor((row.credit_seconds || 0) / 60);
  const planAllowance = plan !== "free" && PLAN_LIMITS[plan] ? PLAN_LIMITS[plan] : 0;
  const purchasedMinutes = Math.max(creditMinutes, planAllowance);
  const minuteLimit = freeTrialMinutes + purchasedMinutes;
  const minutesUsed = Math.round((seconds / 60) * 100) / 100;
  const creditMinutesRemaining = Math.max(0, Math.round((minuteLimit - minutesUsed) * 100) / 100);

  return {
    id: row.id, email: row.email, name: row.name, plan,
    github_username: row.github_username || "",
    profile: row.profile || {}, preferences: row.preferences || {},
    github_verified: Boolean(row.github_verified_id),
    github_verified_username: row.github_verified_username || "",
    minutes_used: minutesUsed,
    minute_limit: minuteLimit,
    monthly_minute_limit: freeTrialMinutes,
    credit_minutes_remaining: creditMinutesRemaining,
    testing_mode: false,
    billing_account: Boolean(row.stripe_customer_id || row.cf_customer_id || purchasedMinutes > 0),
  };
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof MissingEnvError) return json({ detail: error.message }, 503);
  const status = (error as Error & { status?: number }).status;
  if (status) return json({ detail: error instanceof Error ? error.message : "Request failed." }, status);
  return json({ detail: "The server could not complete this request. Please try again." }, 500);
}
