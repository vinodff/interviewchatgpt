import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SitePageContent } from "@/components/site-pages";
import { isSitePage, sitePages } from "@/lib/site-content";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
export const dynamicParams = false;

export function generateStaticParams() { return Object.keys(sitePages).map(slug => ({ slug })); }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  if (!isSitePage(slug)) return { title: "Page not found · InterviewWin" };
  const page = sitePages[slug];
  return { title: `${page.title} · InterviewWin Live`, description: page.description, openGraph: { title: `${page.title} · InterviewWin Live`, description: page.description } };
}

export default async function Page({ params, searchParams }: Props) {
  const { slug } = await params;
  if (!isSitePage(slug)) notFound();
  const query = slug === "contact" ? await searchParams : {};
  const selectedPlan = query.plan === "starter" || query.plan === "pro" ? query.plan : undefined;
  return <SitePageContent slug={slug} selectedPlan={selectedPlan} />;
}
