"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { AudioLines, Code2, FileText, Mic, ShieldCheck, Sparkles } from "lucide-react";

/**
 * Premium hero stage: scroll-linked 3D tilt + mouse tilt + floating icon chips. Transforms are written
 * at most once per frame and the chips bob with CSS keyframes, so nothing here runs while the page is
 * still. With reduced motion the stage stays flat and the chips are hidden.
 */
const FLOATERS = [
  { Icon: Mic, label: "Live mic", className: "floater-left" },
  { Icon: FileText, label: "Your resume", className: "floater-right" },
  { Icon: Code2, label: "Your projects", className: "floater-bottom-left" },
  { Icon: ShieldCheck, label: "With permission", className: "floater-bottom-right" },
  { Icon: Sparkles, label: "Clear answers", className: "floater-top" },
];

// Scroll tilt runs from the stage's top reaching the top of the viewport until its bottom does.
const SCROLL_TILT_START = 8;
const SCROLL_TILT_END = -4;
const SCROLL_LIFT = 40;
const MOUSE_TILT_X = 6;
const MOUSE_TILT_Y = 7;
const SMOOTHING_MS = 120;
const SETTLED_DEGREES = 0.01;

export function HomeHero3D({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const scrollLayer = useRef<HTMLDivElement>(null);
  const tiltLayer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = root.current;
    const scrollElement = scrollLayer.current;
    const tiltElement = tiltLayer.current;
    if (!element || !scrollElement || !tiltElement) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const target = { x: 0, y: 0 };
    const tilt = { x: 0, y: 0 };
    let frame = 0;
    let last = 0;
    const written = new WeakMap<HTMLElement, string>();
    const write = (layer: HTMLElement, transform: string) => {
      if (written.get(layer) === transform) return;
      written.set(layer, transform);
      layer.style.transform = transform;
    };

    const tick = (time: number) => {
      frame = 0;
      const rect = element.getBoundingClientRect();
      if (rect.bottom > -100 && rect.top < window.innerHeight + 100) {
        const progress = Math.min(1, Math.max(0, -rect.top / Math.max(1, rect.height)));
        const rotate = SCROLL_TILT_START + (SCROLL_TILT_END - SCROLL_TILT_START) * progress;
        write(scrollElement, `translateY(${(-SCROLL_LIFT * progress).toFixed(2)}px) rotateX(${rotate.toFixed(3)}deg)`);
      }
      const elapsed = last ? Math.min(64, time - last) : 16;
      last = time;
      const ease = 1 - Math.exp(-elapsed / SMOOTHING_MS);
      tilt.x += (target.x - tilt.x) * ease;
      tilt.y += (target.y - tilt.y) * ease;
      const settled = Math.abs(target.x - tilt.x) < SETTLED_DEGREES && Math.abs(target.y - tilt.y) < SETTLED_DEGREES;
      if (settled) { tilt.x = target.x; tilt.y = target.y; last = 0; }
      write(tiltElement, `rotateX(${tilt.x.toFixed(3)}deg) rotateY(${tilt.y.toFixed(3)}deg)`);
      if (!settled) frame = requestAnimationFrame(tick);
    };
    const schedule = () => { if (!frame && !reduced.matches) frame = requestAnimationFrame(tick); };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const rect = element.getBoundingClientRect();
      target.x = -((event.clientY - rect.top) / rect.height - 0.5) * 2 * MOUSE_TILT_X;
      target.y = ((event.clientX - rect.left) / rect.width - 0.5) * 2 * MOUSE_TILT_Y;
      schedule();
    };
    const onPointerLeave = () => { target.x = 0; target.y = 0; schedule(); };
    const setInView = (visible: boolean) => element.classList.toggle("is-in-view", visible);
    const configure = () => {
      if (!reduced.matches) { schedule(); return; }
      cancelAnimationFrame(frame);
      frame = 0;
      written.delete(scrollElement);
      written.delete(tiltElement);
      scrollElement.style.removeProperty("transform");
      tiltElement.style.removeProperty("transform");
    };

    const visibility = new IntersectionObserver(([entry]) => {
      setInView(entry.isIntersecting);
      if (entry.isIntersecting) schedule();
    }, { rootMargin: "80px 0px" });
    visibility.observe(element);
    configure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    element.addEventListener("pointermove", onPointerMove, { passive: true });
    element.addEventListener("pointerleave", onPointerLeave);
    reduced.addEventListener("change", configure);
    return () => {
      cancelAnimationFrame(frame);
      visibility.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerleave", onPointerLeave);
      reduced.removeEventListener("change", configure);
    };
  }, []);

  return <div ref={root} className="home-hero-3d">
    <div ref={scrollLayer} className="home-hero-3d-scroll">
      <div ref={tiltLayer} className="home-hero-3d-tilt">
        {children}
      </div>
    </div>
    <div className="home-floaters" aria-hidden="true">
      {FLOATERS.map(({ Icon, label, className }, index) => (
        <span key={label} className={`home-floater ${className}`} style={{ "--bob-duration": `${4.5 + index * 0.7}s`, "--bob-tilt": index % 2 ? "3deg" : "-3deg" } as CSSProperties}>
          <Icon size={17} /><span>{label}</span>
        </span>
      ))}
      <span className="home-floater home-floater-audio"><AudioLines size={17} /><span>Listening live</span></span>
    </div>
  </div>;
}
