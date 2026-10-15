import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "InterviewPilot Live · Your work, in your words",
  description: "An evidence-grounded workspace for authorized live interviews and meetings.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
