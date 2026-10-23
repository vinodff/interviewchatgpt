import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "InterviewWin Live · Your work, in your words",
  description: "An evidence-grounded workspace for authorized live interviews and meetings.",
  openGraph: { title: "InterviewWin Live · Your work, in your words", description: "Bring your experience into the conversation with source-grounded live assistance.", siteName: "InterviewWin Live", type: "website" },
  twitter: { card: "summary", title: "InterviewWin Live", description: "Your work, in your words. Live assistance grounded in your experience." },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Script src="https://sdk.cashfree.com/js/v3/cashfree.js" strategy="afterInteractive" />
        {children}
      </body>
    </html>
  );
}
