import type { Metadata } from "next";
import { preconnect } from "react-dom";
import { DesktopApp } from "@/components/desktop/desktop-app";
import "./desktop.css";

export const metadata: Metadata = { title: "InterviewWin Desktop", robots: { index: false, follow: false } };

/** The floating window inside the InterviewWin desktop app. It also renders in a browser for previews. */
export default function Page() {
  // Start the speech-service connection early so Start does not pay for it.
  preconnect("https://generativelanguage.googleapis.com");
  return <DesktopApp />;
}
