import { NextRequest, NextResponse } from "next/server";
import { GET as verifyGet } from "./[orderId]/route";

export async function GET(request: NextRequest) {
  const orderId = request.nextUrl.searchParams.get("order_id");
  if (!orderId) {
    return NextResponse.json({ detail: "Missing order_id query parameter." }, { status: 400 });
  }
  return verifyGet(request, { params: Promise.resolve({ orderId }) });
}
