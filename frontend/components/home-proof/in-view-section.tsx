"use client";

import { useEffect, useRef, type ComponentPropsWithoutRef, type ReactNode } from "react";

/** Marks the section `data-inview` so CSS can pause marquees while it is off screen. */
export function InViewSection({ className, children, ...props }: { className?: string; children: ReactNode } & ComponentPropsWithoutRef<"section">) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      element.dataset.inview = entry.isIntersecting ? "true" : "false";
    }, { rootMargin: "80px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return <section ref={ref} className={className} data-inview="false" {...props}>{children}</section>;
}
