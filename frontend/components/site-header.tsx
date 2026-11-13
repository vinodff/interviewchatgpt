"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, CircleHelp, CreditCard, Info, Mail, Menu, Sparkles, Workflow, X } from "lucide-react";
import { Brand } from "./brand";
import { WHATSAPP_CHANNEL_URL, WhatsAppIcon } from "./whatsapp";

const navigation = [
  { href: "/features", label: "Features", icon: Sparkles },
  { href: "/how-it-works", label: "How it works", icon: Workflow },
  { href: "/plans", label: "Pricing", icon: CreditCard },
  { href: "/help", label: "Help", icon: CircleHelp },
];
const mobileNavigation = [...navigation, { href: "/about", label: "About", icon: Info }, { href: "/contact", label: "Contact Us", icon: Mail }];

export function SiteHeader() {
  const pathname = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 8);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  // The page behind an open menu should not scroll.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  function closeMenu() { if (menu.current) menu.current.open = false; }

  const headerClass = ["site-header", scrolled ? "is-scrolled" : "", open ? "is-menu-open" : ""].filter(Boolean).join(" ");

  return <header className={headerClass}>
    <div className="landing-container site-header-inner">
      <Link href="/" className="landing-brand" aria-label="InterviewWin home" onClick={closeMenu}><Brand /></Link>
      <nav className="site-desktop-nav" aria-label="Main navigation">{navigation.map(item => <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined}>{item.label}</Link>)}</nav>
      <a className="site-header-whatsapp" href={WHATSAPP_CHANNEL_URL} target="_blank" rel="noopener noreferrer" aria-label="Join our WhatsApp channel" title="Join our WhatsApp channel"><WhatsAppIcon size={19} /></a>
      <Link className="site-signin" href="/interview">Sign in</Link>
      <Link className="button button-primary site-open" href="/interview?view=live" aria-label="Start live interview"><span className="site-open-long">Start live interview</span><span className="site-open-short">Start free</span> <ArrowRight size={16} aria-hidden="true" /></Link>
      <details className="site-mobile-menu" ref={menu} onToggle={event => setOpen(event.currentTarget.open)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) closeMenu(); }} onKeyDown={event => { if (event.key === "Escape") { closeMenu(); menu.current?.querySelector("summary")?.focus(); } }}>
        <summary aria-label="Site navigation"><Menu className="menu-open-icon" size={22} /><X className="menu-close-icon" size={22} /></summary>
        <div className="site-menu-panel">
          <nav aria-label="Mobile navigation">{mobileNavigation.map(({ href, label, icon: Icon }, index) => <Link key={href} href={href} style={{ "--i": index } as CSSProperties} aria-current={pathname === href ? "page" : undefined} onClick={closeMenu}><span className="site-menu-icon"><Icon size={18} aria-hidden="true" /></span><span className="site-menu-label">{label}</span><ArrowRight size={16} aria-hidden="true" /></Link>)}</nav>
          <div className="site-menu-actions">
            <Link href="/interview?view=live" className="button button-primary" onClick={closeMenu}>Start live interview <ArrowRight size={17} aria-hidden="true" /></Link>
            <a href={WHATSAPP_CHANNEL_URL} target="_blank" rel="noopener noreferrer" className="site-menu-whatsapp" onClick={closeMenu}><WhatsAppIcon size={19} /> Join our WhatsApp channel</a>
            <Link href="/interview" className="site-menu-signin" onClick={closeMenu}>Already have an account? <strong>Sign in</strong></Link>
          </div>
        </div>
        <button type="button" className="site-menu-backdrop" tabIndex={-1} aria-hidden="true" onClick={closeMenu} />
      </details>
    </div>
  </header>;
}
