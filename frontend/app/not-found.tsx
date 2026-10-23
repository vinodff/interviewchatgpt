import Link from "next/link";
import { ArrowLeft, ArrowRight, AudioLines } from "lucide-react";

export default function NotFound() {
  return <main className="not-found-page"><AudioLines size={38} strokeWidth={1.5} aria-hidden="true" /><p className="eyebrow">404 · A SMALL DETOUR</p><h1>Let’s get you<br />back on track.</h1><p>We couldn’t find that page. Your next conversation is still within reach.</p><div><Link className="button button-primary" href="/"><ArrowLeft size={16} /> Back to home</Link><Link className="button button-secondary" href="/help">Visit the help center <ArrowRight size={16} /></Link></div></main>;
}
