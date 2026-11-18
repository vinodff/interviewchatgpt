import type { Metadata } from "next";
import { headers } from "next/headers";
import { DesktopDownloadPage } from "@/components/desktop-download-page";
import { desktopPlatformFrom } from "@/lib/desktop-download";

const title = "Download for Windows & Mac · InterviewWin Live";
const description = "Get the free InterviewWin desktop app for Windows 10 or 11 and macOS 13 or later. It hears your call’s audio, answers the question on your screen, and uses the same account and minutes.";

export const metadata: Metadata = { title, description, openGraph: { title, description } };

export default async function Page() {
  const requestHeaders = await headers();
  return <DesktopDownloadPage platform={desktopPlatformFrom(requestHeaders.get("user-agent"), requestHeaders.get("sec-ch-ua-platform"))} />;
}
