import { NextRequest, NextResponse } from "next/server";
import { getServiceClientSafe } from "@/lib/supabase-server";

const CASHFREE_APP_ID = process.env.CASHFREE_APP_ID || "";
const CASHFREE_SECRET = process.env.CASHFREE_SECRET || process.env.CASHFREE_SECRET_KEY || "";
const CASHFREE_ENV = (process.env.CASHFREE_ENV || "production").toLowerCase().trim();
const CASHFREE_API_VERSION = process.env.CASHFREE_API_VERSION || "2023-08-01";

const BASE_URL =
  CASHFREE_ENV === "production" || CASHFREE_ENV === "prod"
    ? "https://api.cashfree.com/pg"
    : "https://sandbox.cashfree.com/pg";

function minutesForAmount(amount: number): { plan: string; minutes: number } {
  if (amount >= 500) return { plan: "value", minutes: 120 };
  if (amount >= 200) return { plan: "pro", minutes: 45 };
  return { plan: "starter", minutes: 20 };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;
    if (!orderId) {
      return NextResponse.json({ detail: "Missing orderId." }, { status: 400 });
    }

    const cfResponse = await fetch(`${BASE_URL}/orders/${encodeURIComponent(orderId)}`, {
      method: "GET",
      headers: {
        "x-client-id": CASHFREE_APP_ID,
        "x-client-secret": CASHFREE_SECRET,
        "x-api-version": CASHFREE_API_VERSION,
      },
      cache: "no-store",
    });

    const data = await cfResponse.json();

    if (!cfResponse.ok) {
      return NextResponse.json(
        { detail: data.message || "Failed to retrieve payment status." },
        { status: cfResponse.status || 502 }
      );
    }

    const orderStatus = data.order_status || "PENDING";
    const amount = Number(data.order_amount) || 100;
    const { plan, minutes } = minutesForAmount(amount);

    if (orderStatus === "PAID") {
      const db = getServiceClientSafe();
      if (db) {
        try {
          // Check payment_orders record
          const { data: existingOrder } = await db
            .from("payment_orders")
            .select("*")
            .eq("order_id", orderId)
            .maybeSingle();

          const targetUserId =
            existingOrder?.user_id ||
            (data.customer_details?.customer_id?.startsWith("cust_")
              ? data.customer_details.customer_id.replace("cust_", "")
              : null);

          if (existingOrder && existingOrder.status !== "PAID") {
            await db
              .from("payment_orders")
              .update({
                status: "PAID",
                paid_at: new Date().toISOString(),
                cf_payment_id: data.cf_payment_id || null,
              })
              .eq("order_id", orderId);
          }

          if (targetUserId) {
            const { data: userRow } = await db
              .from("users")
              .select("id, credit_seconds, plan")
              .eq("id", targetUserId)
              .maybeSingle();

            if (userRow) {
              const currentSeconds = userRow.credit_seconds || 0;
              await db
                .from("users")
                .update({
                  plan,
                  credit_seconds: currentSeconds + minutes * 60,
                })
                .eq("id", targetUserId);
            }
          }
        } catch {
          // Proceed with success even if DB update had a partial issue
        }
      }

      return NextResponse.json({
        status: "PAID",
        order_id: orderId,
        plan,
        minutes_granted: minutes,
      });
    }

    return NextResponse.json({
      status: orderStatus,
      order_id: orderId,
      plan,
      minutes_granted: 0,
    });
  } catch (error: any) {
    return NextResponse.json(
      { detail: error.message || "Verification check failed." },
      { status: 500 }
    );
  }
}
