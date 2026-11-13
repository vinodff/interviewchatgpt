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

// Exact prices only. A range check let an order created for ₹1 (the Supabase edge
// function accepts any positive amount) be read as any plan and grant its minutes.
const PLAN_BY_AMOUNT: Record<number, { plan: string; minutes: number }> = Object.fromEntries(
  (Object.keys(PAID_PLANS) as PaidPlanId[]).map(id => [PAID_PLANS[id].amountInr, { plan: id, minutes: PAID_PLANS[id].minutes }])
);

function minutesForAmount(amount: number): { plan: string; minutes: number } | null {
  return PLAN_BY_AMOUNT[Math.round(amount * 100) / 100] ?? null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;
    if (!orderId) {
      return NextResponse.json({ detail: "Missing orderId." }, { status: 400 });
    }

    // Credit grants are keyed by order id, so the caller must own the order before
    // verification can run. Without this any visitor who saw an order id could claim it.
    const authUser = await verifySupabaseUser(request);

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

    if (orderStatus !== "PAID") {
      return NextResponse.json({
        status: orderStatus,
        order_id: orderId,
        minutes_granted: 0,
      });
    }

    const db = getServiceClientSafe();
    if (!db) {
      return NextResponse.json({ detail: "Payments are not configured on this server." }, { status: 503 });
    }

    // Ownership check and entitlement both come from the order we persisted, never
    // from the caller or the provider payload.
    const { data: existingOrder } = await db
      .from("payment_orders")
      .select("*")
      .eq("order_id", orderId)
      .maybeSingle();

    if (!existingOrder || existingOrder.user_id !== authUser.id) {
      return NextResponse.json({ detail: "Order not found." }, { status: 404 });
    }

    const amount = Number(existingOrder.amount) || Number(data.order_amount);
    const entitlement = minutesForAmount(amount);
    if (!entitlement) {
      return NextResponse.json({ detail: "This order does not match a plan price." }, { status: 409 });
    }
    const { plan, minutes } = entitlement;

    if (existingOrder.status !== "PAID") {
      const customerPhone = data.customer_details?.customer_phone || existingOrder.phone;
      const orderUpdates: Record<string, unknown> = {
        status: "PAID",
        paid_at: new Date().toISOString(),
        cf_payment_id: data.cf_payment_id || null,
      };
      if (customerPhone && !existingOrder.phone) {
        orderUpdates.phone = customerPhone;
      }
      await db.from("payment_orders").update(orderUpdates).eq("order_id", orderId);

      const targetUserId = existingOrder.user_id;
      if (targetUserId) {
        try {
          await db.rpc("add_credits_for_user", {
            p_user_id: targetUserId,
            p_amount: minutes,
            p_plan: plan,
          });
          if (customerPhone) {
            await db.from("users").update({ phone: customerPhone }).eq("id", targetUserId);
          }
        } catch {
          const { data: userRow } = await db
            .from("users")
            .select("id, credit_seconds, phone")
            .eq("id", targetUserId)
            .maybeSingle();

          if (userRow) {
            const userUpdates: Record<string, unknown> = {
              credit_seconds: (userRow.credit_seconds || 0) + minutes * 60,
            };
            if (customerPhone && !userRow.phone) {
              userUpdates.phone = customerPhone;
            }
            await db.from("users").update(userUpdates).eq("id", targetUserId);
          }
        }
      }
    }

    return NextResponse.json({
      status: "PAID",
      order_id: orderId,
      plan,
      minutes_granted: minutes,
    });
  } catch (error: unknown) {
    const status = (error as Error & { status?: number }).status;
    const message = error instanceof Error ? error.message : "Verification check failed.";
    return NextResponse.json({ detail: message }, { status: status || 500 });
  }
}
