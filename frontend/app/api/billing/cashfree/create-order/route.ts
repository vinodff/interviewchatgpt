import { NextRequest, NextResponse } from "next/server";
import { getServiceClientSafe, verifySupabaseUser } from "@/lib/supabase-server";
import { PAID_PLANS, type PaidPlanId } from "@/lib/plans";

const CASHFREE_APP_ID = process.env.CASHFREE_APP_ID || "";
const CASHFREE_SECRET =
  process.env.CASHFREE_SECRET ||
  process.env.CASHFREE_SECRET_KEY ||
  "";
const CASHFREE_ENV = (process.env.CASHFREE_ENV || "production").toLowerCase().trim();
const CASHFREE_API_VERSION = process.env.CASHFREE_API_VERSION || "2023-08-01";

const BASE_URL =
  CASHFREE_ENV === "production" || CASHFREE_ENV === "prod"
    ? "https://api.cashfree.com/pg"
    : "https://sandbox.cashfree.com/pg";

const PLAN_AMOUNTS: Record<string, { amount: number; name: string; minutes: number }> = Object.fromEntries(
  (Object.keys(PAID_PLANS) as PaidPlanId[]).map(id => [id, { amount: PAID_PLANS[id].amountInr, name: PAID_PLANS[id].name, minutes: PAID_PLANS[id].minutes }])
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const planId = (body.plan || "starter") as string;
    const planInfo = Object.hasOwn(PLAN_AMOUNTS, planId) ? PLAN_AMOUNTS[planId] : undefined;
    if (!planInfo) {
      return NextResponse.json({ detail: "Invalid plan selected." }, { status: 400 });
    }

    // Identity must come from the verified token only. A client-supplied customer_id
    // would let an anonymous caller attribute an order to, and overwrite data on,
    // another account through the service-role client below.
    const authUser = await verifySupabaseUser(request);
    const userId = authUser.id;
    const userEmail = authUser.email;
    const userName = authUser.name || "InterviewWin Candidate";
    let userPhone = "9876543210";

    if (body.phone && /^[6-9]\d{9}$/.test(String(body.phone).replace(/\D/g, "").slice(-10))) {
      userPhone = String(body.phone).replace(/\D/g, "").slice(-10);
    }

    const cleanCustId = `cust_${userId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20)}`;
    const orderId = `ipo_${planId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const origin =
      request.headers.get("origin") ||
      request.headers.get("x-forwarded-host") ||
      "";
    const isHttps =
      origin.startsWith("https://") &&
      !origin.includes("localhost") &&
      !origin.includes("127.0.0.1") &&
      !origin.includes("0.0.0.0");
    const host = isHttps ? origin : "https://www.interviewwin.live";
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
      order_note: `InterviewWin ${planInfo.name} Plan (${planInfo.minutes} live minutes)`,
      order_meta: {
        return_url: returnUrl,
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
          phone: userPhone,
          created_at: new Date().toISOString(),
        });

        if (userPhone) {
          await db.from("users").update({ phone: userPhone }).eq("id", userId);
        }
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
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Cashfree payment gateway is temporarily unreachable.";
    return NextResponse.json(
      { detail: message },
      { status: 500 }
    );
  }
}
