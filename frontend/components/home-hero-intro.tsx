import Link from "next/link";
import type { CSSProperties } from "react";
import { ArrowRight, FileText, Gift, Play, ShieldCheck } from "lucide-react";
import { BRAND_MARKS } from "@/lib/brand-marks";
import { HomeHeroFloat } from "./home-hero-float";
import { WHATSAPP_CHANNEL_URL, WhatsAppIcon } from "./whatsapp";
import "./home-hero-intro.css";

const PLATFORM_SLUGS = ["zoom", "googlemeet", "webex"] as const;

/** Each word rises in on its own beat; `start` continues the count across lines. */
function Words({ text, start }: { text: string; start: number }) {
  return <>{text.split(" ").map((word, index) => (
    <span key={`${word}-${index}`} className="hhi-word" style={{ "--w": start + index } as CSSProperties}>{word}{" "}</span>
  ))}</>;
}

function PlatformStack() {
  return (
    <span className="hhi-stack" aria-hidden="true">
      {PLATFORM_SLUGS.map(slug => {
        const mark = BRAND_MARKS[slug];
        return mark ? <span key={slug}><svg viewBox="0 0 24 24"><path fill={`#${mark.hex}`} d={mark.path} /></svg></span> : null;
      })}
    </span>
  );
}

/* Only statements that are true of the product today. */
function TrustRow() {
  return (
    <ul className="hhi-trust" aria-label="Why InterviewWin">
      <li><PlatformStack /><span><strong>Works with Zoom, Meet &amp; Webex</strong><small>and any call app</small></span></li>
      <li><span className="hhi-trust-icon"><FileText size={20} aria-hidden="true" /></span><span><strong>Answers from your resume</strong><small>not generic scripts</small></span></li>
      <li><span className="hhi-trust-icon"><Gift size={20} aria-hidden="true" /></span><span><strong>Free minutes to start</strong><small>no card needed</small></span></li>
    </ul>
  );
}

/** Home hero: trust row, headline, two actions, floating app tiles. */
export function HomeHeroIntro() {
  return (
    <div className="home-hero-heading hhi">
      <div className="hhi-glow" aria-hidden="true"><i /><i /><i /></div>
      <HomeHeroFloat />
      <div className="hhi-copy">
        <TrustRow />
        <h1 className="hhi-title">
          <span className="hhi-line"><Words text="Crack" start={0} /><span className="hhi-highlight"><Words text="every interview." start={1} /></span></span>
          <span className="hhi-line"><Words text="Land the job you want." start={3} /></span>
        </h1>
        <p className="home-intro hhi-intro">It hears the question, pulls from your resume, and puts a clear, confident answer on your screen in seconds, so you stay calm and sound like yourself at your best.</p>
        <div className="landing-actions hhi-actions">
          <Link href="/interview?view=live" className="button button-primary hhi-cta">Start live interview <ArrowRight size={18} /></Link>
          <a href="#see-it-work" className="hhi-secondary"><span className="hhi-play"><Play size={13} fill="currentColor" aria-hidden="true" /></span> See how it works</a>
        </div>
        <p className="hhi-fineprint">
          <span><ShieldCheck size={14} aria-hidden="true" /> Use with everyone’s permission</span>
          <a href={WHATSAPP_CHANNEL_URL} target="_blank" rel="noopener noreferrer"><WhatsAppIcon size={15} /> Join our WhatsApp channel</a>
        </p>
      </div>
    </div>
  );
}
