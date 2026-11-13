import { preconnect } from "react-dom";
import { Workspace } from "@/components/workspace";
import { interviewView } from "@/lib/interview-navigation";

export const metadata = { title: "Your interview · InterviewWin Live", robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Open the connection to the speech service while the page loads, so Start does not pay for it.
  preconnect("https://generativelanguage.googleapis.com");
  const query = await searchParams;
  const view = typeof query.view === "string" ? query.view : query.billing ? "billing" : undefined;
  const selectedPlan = query.plan === "starter" || query.plan === "pro" || query.plan === "value" ? query.plan : undefined;
  return <Workspace initialPage={interviewView(view)} initialRegister={query.signup === "1"} initialPlan={selectedPlan} />;
}
