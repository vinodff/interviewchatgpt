import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;

  if (backendUrl) {
    try {
      const res = await fetch(`${backendUrl}/api/sources/${encodeURIComponent(id)}/download`, {
        headers: { "X-InterviewPilot": "1" }
      });
      if (res.ok) {
        const blob = await res.blob();
        return new NextResponse(blob, {
          headers: {
            "Content-Type": res.headers.get("Content-Type") || "application/octet-stream",
            "Content-Disposition": res.headers.get("Content-Disposition") || `attachment; filename="source_${id}"`
          }
        });
      }
    } catch {
      /* Fallback to text view */
    }
  }

  // Fallback response for browser/local storage sources
  const content = `InterviewPilot Knowledge Source (ID: ${id})

This source was uploaded to private browser storage.
Excerpts from this document are securely indexed and used in your live interview workspace.`;

  return new NextResponse(content, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `inline; filename="source_${id}.txt"`
    }
  });
}
