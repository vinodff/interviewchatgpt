import { NextResponse } from "next/server";
import { loadPlans } from "@/lib/server-plans";

export async function GET() { return NextResponse.json(await loadPlans(), { headers: { "Cache-Control": "no-store" } }); }
