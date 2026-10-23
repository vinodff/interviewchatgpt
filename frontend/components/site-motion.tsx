"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/** Animate on entry rather than hiding content while it waits for JavaScript. */
export function SiteMotion() {
  const pathname = usePathname();
  const progress = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const animations = new Set<Animation>();
    let observer: IntersectionObserver | undefined;
    let frame = 0;
    function refreshProgress() {
      frame = 0;
      const length = document.documentElement.scrollHeight - window.innerHeight;
      const value = length > 0 ? Math.min(1, Math.max(0, window.scrollY / length)) : 0;
      if (progress.current) progress.current.style.transform = `scaleX(${value})`;
    }
    function scheduleProgress() { if (!frame) frame = requestAnimationFrame(refreshProgress); }
    function configureReveals() {
      observer?.disconnect();
      animations.forEach(animation => animation.cancel());
      animations.clear();
      if (preference.matches || !("IntersectionObserver" in window) || !Element.prototype.animate) return;
      observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer?.unobserve(entry.target);
          const element = entry.target as HTMLElement;
          // Already visible content remains readable; every animation finishes in its natural state.
          const animation = element.animate(
            [{ opacity: 0.18, transform: "translateY(22px)" }, { opacity: 1, transform: "translateY(0)" }],
            { duration: 650, delay: Number(element.dataset.revealDelay || 0), easing: "cubic-bezier(.22,1,.36,1)" },
          );
          animations.add(animation);
          animation.onfinish = () => animations.delete(animation);
        }
      }, { threshold: 0.08, rootMargin: "0px 0px -24px 0px" });
      document.querySelectorAll(".landing [data-reveal]").forEach(element => observer?.observe(element));
    }
    configureReveals();
    refreshProgress();
    window.addEventListener("scroll", scheduleProgress, { passive: true });
    window.addEventListener("resize", scheduleProgress);
    preference.addEventListener("change", configureReveals);
    return () => {
      observer?.disconnect();
      animations.forEach(animation => animation.cancel());
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", scheduleProgress);
      window.removeEventListener("resize", scheduleProgress);
      preference.removeEventListener("change", configureReveals);
    };
  }, [pathname]);
  return <div className="site-scroll-progress" aria-hidden="true"><div ref={progress} /></div>;
}
