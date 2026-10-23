"use client";

import { useEffect, useRef, type ReactNode } from "react";
import "./scroll-motion.css";

type Layer = { element: HTMLElement; kind: string; index: number };
type Scene = { element: HTMLElement; layers: Layer[]; top: number; height: number; progress: number };
const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** A short, damped follow of native scrolling. The frame loop sleeps when scrolling settles. */
export function ScrollMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = root.current;
    if (!container) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const scenes: Scene[] = Array.from(container.querySelectorAll<HTMLElement>("[data-scroll-scene]")).map(element => ({
      element,
      layers: Array.from(element.querySelectorAll<HTMLElement>("[data-scroll-layer]"))
        .filter(layer => layer.closest("[data-scroll-scene]") === element)
        .map((layer, index) => ({ element: layer, kind: layer.dataset.scrollLayer || "panel", index })),
      top: 0, height: 1, progress: 0,
    }));
    let frame = 0;
    let previousTime = 0;
    let dirty = true;
    let viewportHeight = window.innerHeight;
    let mobile = window.innerWidth <= 760;
    let disposed = false;

    function measure() {
      viewportHeight = window.innerHeight;
      mobile = window.innerWidth <= 760;
      scenes.forEach(scene => {
        // Layout coordinates exclude the entrance animations on parent cards.
        let top = 0;
        let parent: HTMLElement | null = scene.element;
        while (parent) { top += parent.offsetTop; parent = parent.offsetParent as HTMLElement | null; }
        scene.top = top;
        scene.height = Math.max(1, scene.element.offsetHeight);
      });
      dirty = false;
    }

    function target(scene: Scene, scroll: number) {
      return clamp((scroll + viewportHeight - scene.top) / (viewportHeight + scene.height));
    }

    function paint(layer: Layer, progress: number) {
      const distance = mobile ? .65 : 1;
      const centered = progress * 2 - 1;
      let x = 0;
      let y = -centered * 25;
      let rotation = 0;
      let scale = 1;
      switch (layer.kind) {
        case "hero":
          y = -centered * 36;
          scale = 1 + centered * .025;
          break;
        case "device":
          y = -centered * 62;
          rotation = centered * 2.5;
          break;
        case "orbit-left":
          x = centered * 19; y = -centered * 95; rotation = centered * -7;
          break;
        case "orbit-right":
          x = centered * -21; y = -centered * 73; rotation = centered * 8;
          break;
        case "orbit-bottom":
          x = centered * 12; y = -centered * 115; rotation = centered * -6;
          break;
        case "source":
          y = -centered * (22 + layer.index * 6);
          break;
        case "context-answer":
          y = -centered * 38;
          break;
        case "wave":
          y = -centered * 28;
          scale = 1 + centered * .035;
          break;
        case "panel":
          y = -centered * 30;
          rotation = centered * .5;
          break;
      }
      layer.element.style.transform = `translate3d(${(x * distance).toFixed(2)}px, ${(y * distance).toFixed(2)}px, 0) rotate(${(rotation * distance).toFixed(3)}deg) scale(${scale.toFixed(4)})`;
    }

    function stop() {
      cancelAnimationFrame(frame);
      frame = 0;
      previousTime = 0;
      scenes.forEach(scene => scene.element.classList.remove("scroll-scene-active"));
      container!.dataset.scrollState = preference.matches ? "reduced" : "settled";
    }

    function tick(time: number) {
      frame = 0;
      if (disposed || preference.matches || document.hidden) { stop(); return; }
      if (dirty) measure();
      const scroll = window.scrollY;
      const elapsed = previousTime ? Math.min(64, time - previousTime) : 16;
      previousTime = time;
      const damping = 1 - Math.exp(-elapsed / 85);
      let moving = false;
      scenes.forEach(scene => {
        const destination = target(scene, scroll);
        const visible = scene.top < scroll + viewportHeight + 100 && scene.top + scene.height > scroll - 100;
        scene.element.classList.toggle("scroll-scene-active", visible);
        if (!visible) { scene.progress = destination; return; }
        const difference = destination - scene.progress;
        scene.progress = Math.abs(difference) < .0004 ? destination : scene.progress + difference * damping;
        scene.layers.forEach(layer => paint(layer, scene.progress));
        if (Math.abs(destination - scene.progress) >= .0004) moving = true;
      });
      container!.dataset.scrollState = moving ? "moving" : "settled";
      if (moving) frame = requestAnimationFrame(tick);
      else previousTime = 0;
    }

    function schedule() {
      if (!frame && !disposed && !preference.matches && !document.hidden) frame = requestAnimationFrame(tick);
    }
    function resize() { dirty = true; schedule(); }
    function configure() {
      stop();
      if (preference.matches) {
        scenes.forEach(scene => scene.layers.forEach(layer => layer.element.style.removeProperty("transform")));
        return;
      }
      measure();
      scenes.forEach(scene => { scene.progress = target(scene, window.scrollY); });
      schedule();
    }
    function visibility() { if (document.hidden) stop(); else { dirty = true; schedule(); } }

    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(container);
    scenes.forEach(scene => observer?.observe(scene.element));
    configure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", visibility);
    preference.addEventListener("change", configure);
    return () => {
      disposed = true;
      stop();
      observer?.disconnect();
      scenes.forEach(scene => scene.layers.forEach(layer => layer.element.style.removeProperty("transform")));
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", visibility);
      preference.removeEventListener("change", configure);
    };
  }, []);

  return <div ref={root} className="scroll-motion">{children}</div>;
}
