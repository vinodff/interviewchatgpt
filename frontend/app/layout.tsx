import type { Metadata } from "next";
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
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `if(typeof window!=="undefined"&&window.location.hostname.includes("frontend-blush-pi-24.vercel.app")){window.location.replace("https://www.interviewwin.live"+window.location.pathname+window.location.search+window.location.hash);}`,
          }}
        />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
