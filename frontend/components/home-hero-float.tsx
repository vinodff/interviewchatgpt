"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { CheckCircle2, Code2, FileText, Mic, Sparkles } from "lucide-react";
import { BRAND_MARKS } from "@/lib/brand-marks";
import { WhatsAppIcon } from "./whatsapp";

type Depth = "near" | "mid" | "far";
type Tile = { id: string; label: string; x: number; y: number; depth: Depth; rotate: number; icon: ReactNode };

const PARALLAX_EASE = 0.08;

function BrandMark({ slug }: { slug: string }) {
  const mark = BRAND_MARKS[slug];
  if (!mark) return null;
  return <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true"><path fill={`#${mark.hex}`} d={mark.path} /></svg>;
}

/* Positions are % of the hero box. Near tiles are big and sharp, far tiles small and blurred (depth of field). */
const TILES: Tile[] = [
  { id: "zoom", label: "Zoom", x: 9, y: 24, depth: "near", rotate: -9, icon: <BrandMark slug="zoom" /> },
  { id: "mic", label: "Live microphone capture", x: 4.5, y: 47, depth: "mid", rotate: 7, icon: <Mic strokeWidth={1.8} /> },
  { id: "meet", label: "Google Meet", x: 8, y: 84, depth: "mid", rotate: -5, icon: <BrandMark slug="googlemeet" /> },
  { id: "code", label: "Coding rounds", x: 19, y: 97, depth: "far", rotate: 10, icon: <Code2 strokeWidth={1.8} /> },
  { id: "webex", label: "Webex", x: 91, y: 22, depth: "near", rotate: 8, icon: <BrandMark slug="webex" /> },
  { id: "whatsapp", label: "WhatsApp", x: 95.5, y: 46, depth: "mid", rotate: -7, icon: <WhatsAppIcon size={34} /> },
  { id: "resume", label: "Your resume", x: 92, y: 83, depth: "far", rotate: 6, icon: <FileText strokeWidth={1.8} /> },
  { id: "ai", label: "AI answers", x: 81, y: 97, depth: "mid", rotate: -10, icon: <Sparkles strokeWidth={1.8} /> },
];

/** Floating app tiles and live cards around the hero copy. Moves gently with the pointer on desktop. */
export function HomeHeroFloat() {
  const layer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = layer.current;
    if (!element) return;
    const finePointer = window.matchMedia("(pointer: fine) and (prefers-reduced-motion: no-preference)");
    if (!finePointer.matches) return;
    const target = { x: 0, y: 0 };
    const current = { x: 0, y: 0 };
    let frame = 0;
    const step = () => {
      current.x += (target.x - current.x) * PARALLAX_EASE;
      current.y += (target.y - current.y) * PARALLAX_EASE;
      element.style.setProperty("--mx", current.x.toFixed(4));
      element.style.setProperty("--my", current.y.toFixed(4));
      const settled = Math.abs(target.x - current.x) < 0.001 && Math.abs(target.y - current.y) < 0.001;
      frame = settled ? 0 : requestAnimationFrame(step);
    };
    const onMove = (event: PointerEvent) => {
      target.x = event.clientX / window.innerWidth - 0.5;
      target.y = event.clientY / window.innerHeight - 0.5;
      if (!frame) frame = requestAnimationFrame(step);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <div ref={layer} className="hhf" aria-hidden="true">
      {TILES.map((tile, index) => (
        <span
          key={tile.id}
          className={`hhf-tile hhf-${tile.depth}`}
          style={{ "--x": `${tile.x}%`, "--y": `${tile.y}%`, "--r": `${tile.rotate}deg`, "--i": index } as CSSProperties}
          title={tile.label}
        >
          <span className="hhf-face"><span className="hhf-icon">{tile.icon}</span></span>
        </span>
      ))}
      <span className="hhf-card hhf-card-question" style={{ "--x": "17%", "--y": "65%", "--i": 3 } as CSSProperties}>
        <span className="hhf-face"><span className="hhf-card-label"><Mic size={12} /> Interviewer</span>“Tell me about yourself.”</span>
      </span>
      <span className="hhf-card hhf-card-answer" style={{ "--x": "83%", "--y": "65%", "--i": 5 } as CSSProperties}>
        <span className="hhf-face"><span className="hhf-card-ready"><CheckCircle2 size={14} /> Answer ready</span><span className="hhf-card-source">from resume.pdf</span></span>
      </span>
    </div>
  );
}
