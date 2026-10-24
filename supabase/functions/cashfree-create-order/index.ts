import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CASHFREE_API = "https://api.cashfree.com/pg/orders";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const appId = Deno.env.get("CASHFREE_APP_ID") ?? "";
    const secret = Deno.env.get("CASHFREE_SECRET") ?? "";

    const body = await req.json();
    const amount = Number(body.amount);
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const customerId = typeof body.customer_id === "string" ? body.customer_id.trim() : "";
    const plan = typeof body.plan === "string" ? body.plan.trim() : "";

    // Validate inputs
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) {
      return new Response(
        JSON.stringify({ error: "Invalid amount" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(
        JSON.stringify({ error: "Invalid email format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const orderId = `iwin_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const response = await fetch(CASHFREE_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-version": "2023-08-01",
        "x-client-id": appId,
        "x-client-secret": secret,
      },
      body: JSON.stringify({
        order_id: orderId,
        order_amount: amount,
        order_currency: "INR",
        customer_details: {
          customer_id: customerId || `cust_${Date.now()}`,
          customer_email: email || "user@interviewwin.com",
          customer_phone: phone || "9999999999",
        },
        order_note: `InterviewWin ${plan ? plan.toUpperCase() + " " : ""}Credits`,
        order_meta: { notify_url: "" },
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.payment_session_id) {
      return new Response(
        JSON.stringify({ error: data.message || JSON.stringify(data) }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        payment_session_id: data.payment_session_id,
        order_id: orderId,
        amount: amount,
        plan: plan,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
