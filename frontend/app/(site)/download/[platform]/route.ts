import { NextResponse, type NextRequest } from "next/server";
import { desktopInstallerUrl, isDesktopPlatform } from "@/lib/desktop-download";

/** /download/windows and /download/mac start the current installer; anything else shows the download page. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  if (!isDesktopPlatform(platform)) return NextResponse.redirect(new URL("/download", request.url));
  return NextResponse.redirect(desktopInstallerUrl(platform, process.env));
}
