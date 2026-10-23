import { Workspace } from "@/components/workspace";
import { interviewView } from "@/lib/interview-navigation";

export const metadata = { title: "Your interview · InterviewWin Live", robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const view = typeof query.view === "string" ? query.view : query.billing ? "billing" : undefined;
  const selectedPlan = query.plan === "starter" || query.plan === "pro" || query.plan === "value" ? query.plan : undefined;
  return <Workspace initialPage={interviewView(view)} initialRegister={query.signup === "1"} initialPlan={selectedPlan} />;
}
