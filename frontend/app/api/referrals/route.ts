import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, getServerSupabase } from "@/lib/server-supabase";
import { attachReferral, claimSpin, referralStatus, type ReferralUserRow } from "@/lib/server-referrals";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function context(request: NextRequest) {
  const db = getServerSupabase();
  if (!db) return { error: json({ detail: "Referrals are unavailable right now." }, 503) } as const;
  const auth = await getAuthenticatedUser(request);
  if (!auth) return { error: json({ detail: "Sign in is required." }, 401) } as const;
  const { data: row } = await db.from("users").select("id, profile, credit_seconds, created_at").eq("id", auth.user.id).maybeSingle();
  if (!row) return { error: json({ detail: "Account not found." }, 404) } as const;
  return { db, auth, row: row as ReferralUserRow } as const;
}

/** The signed-in user's invite code, friends counted, and spins available. */
export async function GET(request: NextRequest) {
  const ctx = await context(request);
  if ("error" in ctx) return ctx.error;
  return json(await referralStatus(ctx.db, ctx.row));
}

/** { action: "attach", code } credits this new account to an inviter; { action: "spin" } claims one spin. */
export async function POST(request: NextRequest) {
  const ctx = await context(request);
  if ("error" in ctx) return ctx.error;
  const body = await request.json().catch(() => ({})) as { action?: unknown; code?: unknown };

  if (body.action === "attach") {
    const { data: { user: authUser } } = await ctx.db.auth.getUser(ctx.auth.token);
    const verified = Boolean(authUser?.email_confirmed_at || authUser?.phone_confirmed_at);
    const result = await attachReferral(ctx.db, ctx.row, typeof body.code === "string" ? body.code.toUpperCase() : body.code, { verified, accountCreatedAt: authUser?.created_at ?? ctx.row.created_at });
    // 403 tells the client to keep the code and retry after the email is verified.
    return json({ result }, result === "attached" || result === "already_referred" ? 200 : result === "not_verified" ? 403 : 409);
  }

  if (body.action === "spin") {
    const random = crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
    const spin = await claimSpin(ctx.db, ctx.row, random);
    if (!spin.ok) return json({ detail: spin.reason === "no_spins" ? "Invite more friends to unlock a spin." : "Please try again." }, spin.reason === "no_spins" ? 409 : 429);
    return json(spin);
  }

  return json({ detail: "Unknown action." }, 400);
}
