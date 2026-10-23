import { redirect } from "next/navigation";
import { legacyInterviewUrl } from "@/lib/interview-navigation";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(legacyInterviewUrl(await searchParams));
}
