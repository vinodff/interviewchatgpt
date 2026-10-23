import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, AudioLines } from "lucide-react";
import { Brand } from "./brand";
import { SiteHeader } from "./site-header";
import { SiteMotion } from "./site-motion";
import { supportEmail } from "@/lib/site-content";

const footerGroups = [
  { title: "Product", links: [["Features", "/features"], ["How it works", "/how-it-works"], ["Pricing", "/plans"], ["Start live interview", "/interview?view=live"]] },
  { title: "Resources", links: [["About", "/about"], ["Help center", "/help"], ["Contact", "/contact"]] },
  { title: "The essentials", links: [["Privacy policy", "/privacy"], ["Terms of use", "/terms"]] },
];

export function SiteShell({ children }: { children: ReactNode }) {
  return <div className="landing site-shell"><a className="skip-link" href="#landing-main">Skip to content</a><SiteMotion /><SiteHeader /><main id="landing-main" tabIndex={-1}>{children}</main>
    <footer className="site-footer"><div className="landing-container"><div className="site-footer-grid"><div className="site-footer-brand"><Link href="/" className="landing-brand" aria-label="InterviewWin home"><Brand /></Link><p>Your experience is the source.<br />Your voice makes the difference.</p><a href={`mailto:${supportEmail}`}>{supportEmail}</a></div>{footerGroups.map(group => <nav aria-label={group.title} key={group.title}><h2>{group.title}</h2>{group.links.map(([label, href]) => <Link href={href} key={href}>{label}</Link>)}</nav>)}</div><div className="site-footer-bottom"><span>© {new Date().getFullYear()} InterviewWin Live</span><span><AudioLines size={14} aria-hidden="true" /> Assistance with permission. Always.</span></div></div></footer>
  </div>;
}

export function SiteCta() {
  return <section className="landing-final"><div className="landing-container" data-reveal><p className="eyebrow">BRING WHAT YOU KNOW</p><h2>Make room for a<br /><em>better conversation.</em></h2><Link href="/interview?view=live" className="button button-primary">Start live interview <ArrowRight size={18} aria-hidden="true" /></Link><p>Start with your experience. Keep your own voice.</p></div></section>;
}
