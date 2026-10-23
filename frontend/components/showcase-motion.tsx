"use client";

import { useEffect, useRef, type ReactNode } from "react";

const ease = "cubic-bezier(.22, 1, .36, 1)";

/** Server-rendered examples stay readable. Motion only enhances a visible card. */
export function ShowcaseMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = root.current;
    if (!container || !Element.prototype.animate) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const cards = Array.from(container.querySelectorAll<HTMLElement>("[data-showcase]"));
    const active = new Map<HTMLElement, Set<Animation>>();
    const seen = new Set<HTMLElement>();
    let observer: IntersectionObserver | undefined;
    let disposed = false;

    function finish(card: HTMLElement) {
      active.get(card)?.forEach(animation => animation.cancel());
      active.delete(card);
      card.dataset.animationState = preference.matches ? "reduced" : seen.has(card) ? "complete" : "ready";
    }

    function play(card: HTMLElement) {
      finish(card);
      if (disposed || preference.matches || document.hidden) return;
      seen.add(card);
      card.dataset.animationState = "playing";
      const animations = new Set<Animation>();
      active.set(card, animations);
      const animate = (element: Element, frames: Keyframe[], duration: number, delay = 0) => {
        const animation = element.animate(frames, { duration, delay, easing: ease, fill: "backwards" });
        animations.add(animation);
        animation.onfinish = () => {
          animations.delete(animation);
          if (!animations.size && active.get(card) === animations) {
            active.delete(card);
            card.dataset.animationState = "complete";
          }
        };
      };
      animate(card, [{ opacity: .6, transform: "translateY(22px)" }, { opacity: 1, transform: "translateY(0)" }], 700);
      const counts = new Map<string, number>();
      card.querySelectorAll<HTMLElement | SVGElement>("[data-showcase-motion]").forEach(element => {
        const kind = element.dataset.showcaseMotion || "node";
        const index = counts.get(kind) || 0;
        counts.set(kind, index + 1);
        const base = getComputedStyle(element).transform;
        const finalTransform = base === "none" ? "" : base;
        const enter = (distance: number) => [
          { opacity: .12, transform: `${finalTransform} translateY(${distance}px)` },
          { opacity: 1, transform: finalTransform || "none" },
        ];
        switch (kind) {
          case "code-line":
            animate(element, enter(8), 420, 150 + Math.min(index, 14) * 110);
            break;
          case "wave":
            animate(element, [
              { transform: "scaleY(.2)", opacity: .3 },
              { transform: "scaleY(1)", opacity: 1, offset: .25 },
              { transform: "scaleY(.35)", opacity: .6, offset: .55 },
              { transform: "scaleY(.85)", opacity: 1, offset: .8 },
              { transform: "scaleY(1)", opacity: 1 },
            ], 1800, Math.min(index, 45) * 15);
            break;
          case "transcript":
            animate(element, enter(5), 500, 450 + Math.min(index, 10) * 130);
            break;
          case "connector":
            animate(element, [{ strokeDasharray: "1", strokeDashoffset: "1", opacity: .2 }, { strokeDasharray: "1", strokeDashoffset: "0", opacity: 1 }], 1150, 200 + index * 100);
            break;
          case "answer":
            animate(element, enter(16), 750, 1000);
            break;
          case "phone":
            animate(element, enter(36), 1100, 100);
            break;
          case "orbit":
            animate(element, [
              { opacity: .1, transform: `${finalTransform} translateY(24px) scale(.9)` },
              { opacity: 1, transform: `${finalTransform} translateY(-8px) scale(1)`, offset: .7 },
              { opacity: 1, transform: finalTransform || "none" },
            ], 1800, Math.min(index, 6) * 140);
            break;
          default:
            animate(element, enter(12), 700, 140 + Math.min(index, 8) * 130);
        }
      });
    }

    function configure() {
      observer?.disconnect();
      cards.forEach(finish);
      container!.dataset.motion = preference.matches ? "reduced" : "full";
      if (preference.matches || !("IntersectionObserver" in window)) return;
      observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          const card = entry.target.closest<HTMLElement>("[data-showcase]");
          if (!card) return;
          if (entry.isIntersecting && entry.intersectionRatio >= .18) {
            if (!seen.has(card)) play(card);
          } else if (!entry.isIntersecting && active.has(card)) {
            finish(card);
          }
        });
      }, { threshold: .18 });
      cards.forEach(card => observer!.observe(card.querySelector("[data-showcase-trigger]") || card));
    }

    function stopWhenHidden() { if (document.hidden) cards.forEach(finish); }
    function handleClick(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest("[data-showcase-replay]");
      const card = button?.closest<HTMLElement>("[data-showcase]");
      if (card && container?.contains(card)) play(card);
    }
    container.classList.add("showcase-ready");
    configure();
    container.addEventListener("click", handleClick);
    preference.addEventListener("change", configure);
    document.addEventListener("visibilitychange", stopWhenHidden);
    return () => {
      disposed = true;
      observer?.disconnect();
      cards.forEach(finish);
      container.classList.remove("showcase-ready");
      container.removeEventListener("click", handleClick);
      preference.removeEventListener("change", configure);
      document.removeEventListener("visibilitychange", stopWhenHidden);
    };
  }, []);

  return <div ref={root} className="showcase-motion">{children}</div>;
}
