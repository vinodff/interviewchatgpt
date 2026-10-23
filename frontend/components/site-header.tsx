"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { ArrowRight, Menu, X } from "lucide-react";
import { Brand } from "./brand";

const navigation = [
  { href: "/features", label: "Features" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/plans", label: "Pricing" },
  { href: "/help", label: "Help" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  function closeMenu() { if (menu.current) menu.current.open = false; }
  return <header className="site-header">
    <div className="landing-container site-header-inner">
      <Link href="/" className="landing-brand" aria-label="InterviewWin home" onClick={closeMenu}><Brand /></Link>
      <nav className="site-desktop-nav" aria-label="Main navigation">{navigation.map(item => <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined}>{item.label}</Link>)}</nav>
      <Link className="button button-primary site-open" href="/interview?view=live">Start live interview <ArrowRight size={16} aria-hidden="true" /></Link>
      <details className="site-mobile-menu" ref={menu} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) closeMenu(); }} onKeyDown={event => { if (event.key === "Escape") { closeMenu(); menu.current?.querySelector("summary")?.focus(); } }}>
        <summary aria-label="Site navigation"><Menu className="menu-open-icon" size={22} /><X className="menu-close-icon" size={22} /></summary>
        <nav aria-label="Mobile navigation">{[...navigation, { href: "/about", label: "About" }, { href: "/contact", label: "Contact" }].map(item => <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined} onClick={closeMenu}>{item.label}<ArrowRight size={16} /></Link>)}</nav>
      </details>
    </div>
  </header>;
}
