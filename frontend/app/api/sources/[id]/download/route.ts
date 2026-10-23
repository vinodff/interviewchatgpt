import { NextRequest, NextResponse } from "next/server";
import { proxyBackend } from "@/lib/server-proxy";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.NEXT_PUBLIC_WORKSPACE_MODE === "browser") return NextResponse.json({ detail: "Open this document from its evidence link in the browser workspace." }, { status: 404 });
  const { id } = await params;
  return proxyBackend(request, ["sources", id, "download"]);
}
