import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import type { Evidence, Preferences, Project, Session, Source, Turn, User } from "./types";

export function getServerSupabase(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    "";
  if (!supabaseUrl || !supabaseKey) return null;
  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function extractAuthToken(request: NextRequest): string | null {
  const cookie = request.cookies.get("interviewpilot_session")?.value;
  if (cookie) return cookie;
  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }
  for (const cookieItem of request.cookies.getAll()) {
    if (cookieItem.name.startsWith("sb-") && cookieItem.name.endsWith("-auth-token")) {
      try {
        const val = decodeURIComponent(cookieItem.value);
        if (val.startsWith("[")) {
          const arr = JSON.parse(val);
          if (Array.isArray(arr) && typeof arr[0] === "string") return arr[0];
        } else if (val.startsWith("{")) {
          const obj = JSON.parse(val);
          if (typeof obj?.access_token === "string") return obj.access_token;
        } else if (val.length > 50) {
          return val;
        }
      } catch {
        // ignore
      }
    }
  }
  return null;
}

export interface SupabaseUserRow {
  id: string;
  email?: string;
  name?: string;
  plan?: string;
  phone?: string | null;
  github_username?: string;
  github_verified_id?: number | null;
  github_verified_username?: string;
  profile?: Record<string, unknown>;
  preferences?: Record<string, unknown>;
  credit_seconds?: number | null;
  stripe_customer_id?: string | null;
  cf_customer_id?: string | null;
  [key: string]: unknown;
}

export async function formatUserResponse(supabase: SupabaseClient, userRow: SupabaseUserRow): Promise<User> {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const { data: bucket } = await supabase
    .from("usage_buckets")
    .select("seconds")
    .eq("user_id", userRow.id)
    .eq("month", currentMonth)
    .maybeSingle();

  const secondsUsed = bucket?.seconds || 0;
  const minutesUsed = Number((secondsUsed / 60).toFixed(1));
  const plan = userRow.plan || "free";
  const creditSeconds = userRow.credit_seconds || 0;
  const creditMinutes = Math.floor(creditSeconds / 60);

  // Free: 2 mins, Starter: 20 mins, Pro: 45 mins, Value: 120 mins
  const freeTrialMinutes = 2;
  const planAllowance = plan === "starter" ? 20 : plan === "pro" ? 45 : plan === "value" ? 120 : 0;
  const purchasedMinutes = Math.max(creditMinutes, planAllowance);
  const minuteLimit = freeTrialMinutes + purchasedMinutes;
  const creditMinutesRemaining = Math.max(0, Math.round((minuteLimit - minutesUsed) * 10) / 10);

  return {
    id: userRow.id,
    email: userRow.email || "",
    name: userRow.name || userRow.email?.split("@")[0] || "User",
    plan,
    phone: userRow.phone || null,
    github_username: userRow.github_username || "",
    github_verified: Boolean(userRow.github_verified_id),
    github_verified_username: userRow.github_verified_username || "",
    profile: (userRow.profile && typeof userRow.profile === "object") ? userRow.profile : {},
    preferences: (userRow.preferences && typeof userRow.preferences === "object") ? userRow.preferences : {},
    minutes_used: minutesUsed,
    minute_limit: minuteLimit,
    testing_mode: false, // Connected real user in Supabase database
    credit_minutes_remaining: creditMinutesRemaining,
    monthly_minute_limit: freeTrialMinutes,
    billing_account: true,
  };
}

export async function getAuthenticatedUser(request: NextRequest): Promise<{ user: User; token: string; authId: string } | null> {
  const token = extractAuthToken(request);
  if (!token) return null;
  const supabase = getServerSupabase();
  if (!supabase) return null;

  const { data: { user: authUser }, error } = await supabase.auth.getUser(token);
  if (error || !authUser) return null;

  let { data: userRow } = await supabase.from("users").select("*").eq("id", authUser.id).maybeSingle();
  if (!userRow && authUser.email && Boolean(authUser.email_confirmed_at)) {
    const { data: byEmail } = await supabase.from("users").select("*").eq("email", authUser.email).maybeSingle();
    if (byEmail) userRow = byEmail;
  }
  if (!userRow) {
    const name = authUser.user_metadata?.full_name || authUser.user_metadata?.name || authUser.email?.split("@")[0] || "User";
    const { data: created, error: createError } = await supabase.from("users").insert({
      id: authUser.id,
      email: authUser.email || "",
      name,
      password_hash: "supabase_oauth",
      plan: "free",
      credit_seconds: 0,
      profile: {},
      preferences: {},
      created_at: new Date().toISOString(),
    }).select().single();
    if (!createError && created) userRow = created;
    else if (!userRow) return null;
  }

  const user = await formatUserResponse(supabase, userRow);
  return { user, token, authId: userRow.id };
}

export function setSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set("interviewpilot_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set("interviewpilot_session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export function chunkText(text: string, chunkSize = 800, overlap = 100): string[] {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];
  if (cleaned.length <= chunkSize) return [cleaned];

  const chunks: string[] = [];
  let start = 0;
  while (start < cleaned.length) {
    let end = start + chunkSize;
    if (end < cleaned.length) {
      const paragraphBreak = cleaned.lastIndexOf("\n\n", end);
      if (paragraphBreak > start + chunkSize / 2) {
        end = paragraphBreak + 2;
      } else {
        const sentenceBreak = cleaned.lastIndexOf(". ", end);
        if (sentenceBreak > start + chunkSize / 2) {
          end = sentenceBreak + 2;
        } else {
          const spaceBreak = cleaned.lastIndexOf(" ", end);
          if (spaceBreak > start + chunkSize / 2) {
            end = spaceBreak + 1;
          }
        }
      }
    } else {
      end = cleaned.length;
    }
    const chunk = cleaned.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}
