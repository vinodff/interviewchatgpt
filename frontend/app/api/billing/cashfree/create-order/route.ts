import { NextRequest, NextResponse } from "next/server";
import { getServiceClientSafe, verifySupabaseUser } from "@/lib/supabase-server";

const CASHFREE_APP_ID = process.env.CASHFREE_APP_ID || "";
const CASHFREE_SECRET = process.env.CASHFREE_SECRET || process.env.CASHFREE_SECRET_KEY || "";
const CASHFREE_ENV = (process.env.CASHFREE_ENV || "production").toLowerCase().trim();
const CASHFREE_API_VERSION = process.env.CASHFREE_API_VERSION || "2023-08-01";

const BASE_URL =
  CASHFREE_ENV === "production" || CASHFREE_ENV === "prod"
    ? "https://api.cashfree.com/pg"
    : "https://sandbox.cashfree.com/pg";

const PLAN_AMOUNTS: Record<string, { amount: number; name: string; minutes: number }> = {
  starter: { amount: 100, name: "Starter", minutes: 20 },
  pro: { amount: 200, name: "Popular", minutes: 45 },
  value: { amount: 500, name: "Value", minutes: 120 },
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const planId = (body.plan || "starter") as string;
    const planInfo = PLAN_AMOUNTS[planId];
    if (!planInfo) {
      return NextResponse.json({ detail: "Invalid plan selected." }, { status: 400 });
    }

    // Try to get authenticated user, or fall back to payload / anonymous
    let userId = `usr_${Math.random().toString(36).substring(2, 10)}`;
    let userEmail = "candidate@interviewwin.com";
    let userName = "InterviewWin Candidate";
    let userPhone = "9876543210";

    if (body.phone && /^[6-9]\d{9}$/.test(String(body.phone).replace(/\D/g, "").slice(-10))) {
      userPhone = String(body.phone).replace(/\D/g, "").slice(-10);
    }

    try {
      const authUser = await verifySupabaseUser(request);
      if (authUser?.id) {
        userId = authUser.id;
        userEmail = authUser.email || userEmail;
        userName = authUser.name || userName;
      }
    } catch {
      // Unauthenticated checkout or browser token, allow continuation
    }

    const cleanCustId = `cust_${userId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20)}`;
    const orderId = `ipo_${planId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const origin =
      request.headers.get("origin") ||
      request.headers.get("x-forwarded-host") ||
      "https://www.interviewwin.live";
    const host = origin.startsWith("http") ? origin : `https://${origin}`;
    const returnUrl = `${host}/interview?view=billing&cf_order_id={order_id}`;

    const payload = {
      order_id: orderId,
      order_amount: planInfo.amount,
      order_currency: "INR",
      customer_details: {
        customer_id: cleanCustId,
        customer_name: userName.slice(0, 50),
        customer_email: userEmail,
        customer_phone: userPhone,
      },
      order_note: `InterviewPilot ${planInfo.name} Plan (${planInfo.minutes} live minutes)`,
      order_meta: {
        notify_url: "",
      },
    };

    const cfResponse = await fetch(`${BASE_URL}/orders`, {
      method: "POST",
      headers: {
        "x-client-id": CASHFREE_APP_ID,
        "x-client-secret": CASHFREE_SECRET,
        "x-api-version": CASHFREE_API_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await cfResponse.json();

    if (!cfResponse.ok || !data.payment_session_id) {
      const msg = data.message || "Failed to initialize secure checkout with Cashfree.";
      return NextResponse.json({ detail: msg }, { status: cfResponse.status || 502 });
    }

    // Try saving record in Supabase payment_orders if database is reachable
    try {
      const db = getServiceClientSafe();
      if (db) {
        await db.from("payment_orders").insert({
          id: crypto.randomUUID(),
          order_id: data.order_id,
          user_id: userId,
          plan_id: planId,
          amount: planInfo.amount,
          currency: "INR",
          status: "ACTIVE",
          payment_session_id: data.payment_session_id,
          minutes_granted: planInfo.minutes,
          created_at: new Date().toISOString(),
        });
      }
    } catch {
      // payment_orders table might not exist yet; do not fail checkout
    }

    return NextResponse.json({
      order_id: data.order_id,
      payment_session_id: data.payment_session_id,
      amount: planInfo.amount,
      plan: planId,
      environment: CASHFREE_ENV === "production" || CASHFREE_ENV === "prod" ? "production" : "sandbox",
    });
  } catch (error: any) {
    return NextResponse.json(
      { detail: error.message || "Cashfree payment gateway is temporarily unreachable." },
      { status: 500 }
    );
  }
}
