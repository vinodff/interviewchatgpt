"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, CreditCard, ExternalLink, LogOut, MoreVertical, Move, X } from "lucide-react";
import { BrandMark } from "./desktop-ui";

type Props = {
  minutes: string | null;
  collapsed: boolean;
  onCollapse: () => void;
  onClose: () => void;
  onDashboard: () => void;
  onBuyMinutes: () => void;
  onSignOut: (() => void) | null;
};

/** The card's title bar: drag anywhere on it, plus minutes, menu, collapse and close. */
export function DesktopHeader({ minutes, collapsed, onCollapse, onClose, onDashboard, onBuyMinutes, onSignOut }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => { if (!menu.current?.contains(event.target as Node)) setMenuOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, [menuOpen]);
  const pick = (action: () => void) => () => { setMenuOpen(false); action(); };
  return <header className="iwd-header">
    <div className="iwd-header-brand"><BrandMark /><span>Interview<em>Win</em></span></div>
    <div className="iwd-header-actions">
      {minutes && <span className="iwd-minutes" title="Live minutes left on your plan">{minutes}</span>}
      <span className="iwd-icon-btn iwd-drag" title="Drag to move" aria-hidden="true"><Move size={15} /></span>
      <div className="iwd-menu-wrap" ref={menu}>
        <button type="button" className="iwd-icon-btn" aria-label="More options" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}><MoreVertical size={15} /></button>
        {menuOpen && <div className="iwd-menu" role="menu">
          <button type="button" role="menuitem" onClick={pick(onDashboard)}><ExternalLink size={14} aria-hidden="true" /> Open dashboard</button>
          <button type="button" role="menuitem" onClick={pick(onBuyMinutes)}><CreditCard size={14} aria-hidden="true" /> Buy minutes</button>
          {onSignOut && <button type="button" role="menuitem" onClick={pick(onSignOut)}><LogOut size={14} aria-hidden="true" /> Sign out</button>}
        </div>}
      </div>
      <button type="button" className="iwd-icon-btn" aria-label={collapsed ? "Expand" : "Collapse"} aria-expanded={!collapsed} onClick={onCollapse}>{collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}</button>
      <button type="button" className="iwd-icon-btn iwd-close" aria-label="Close InterviewWin" onClick={onClose}><X size={15} /></button>
    </div>
  </header>;
}
