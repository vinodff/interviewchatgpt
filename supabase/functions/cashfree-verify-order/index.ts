import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const appId = Deno.env.get("CASHFREE_APP_ID") ?? "";
    const secret = Deno.env.get("CASHFREE_SECRET") ?? "";

    let order_id = "";
    if (req.method === "GET") {
      const url = new URL(req.url);
      order_id = url.searchParams.get("order_id") || "";
    } else {
      const body = await req.json().catch(() => ({}));
      order_id = body.order_id || "";
    }

    if (
      typeof order_id !== "string" ||
      order_id.length === 0 ||
      order_id.length > 64 ||
      !/^[A-Za-z0-9_-]+$/.test(order_id)
    ) {
      return new Response(
        JSON.stringify({ error: "Invalid order_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const response = await fetch(`https://api.cashfree.com/pg/orders/${order_id}`, {
      method: "GET",
      headers: {
        "x-api-version": "2023-08-01",
        "x-client-id": appId,
        "x-client-secret": secret,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: data.message || "Verify failed" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        order_status: data.order_status,
        order_amount: data.order_amount,
        cf_payment_id: data.cf_payment_id || null,
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
