"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import type { HtmlPortal, SceneState } from "./devices";
import { PHASE_WINDOWS, STEPS, phasesAt, stepAt, type PhaseName } from "./timeline";
import "./interview-scene.css";

const SceneCanvas = dynamic(() => import("./scene-canvas"), { ssr: false });

// Scroll glide: a wheel notch becomes a smooth move rather than a jump.
const SMOOTHING_MS = 180;
const REDUCED_MOTION_PROGRESS = 0.74;
const SETTLE_EPSILON = 0.0004;
const PHASE_NAMES = Object.keys(PHASE_WINDOWS) as PhaseName[];
const SCREEN_IMAGES = ["/scene/interviewer.webp", "/scene/candidate.webp"];
/** Frames are rendered only while this share of the pinned stage is on screen; a sliver at the fold keeps its last frame. */
const VISIBLE_SHARE = 0.1;
/** The visitor counts as reading, not scrolling, after this long without a scroll event. */
const QUIET_MS = 400;
/** WebGL drops to one frame per progress tick while scrolling; after this pause it runs freely again. */
const SCROLLING_MS = 140;

type Stage = "waiting" | "webgl" | "fallback";

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return Boolean(gl);
  } catch {
    return false;
  }
}

function requestIdle(callback: () => void): number {
  const ric = window.requestIdleCallback?.bind(window);
  if (ric) return ric(callback, { timeout: 4000 });
  return window.setTimeout(callback, 250);
}

function cancelIdle(handle: number) {
  if (window.cancelIdleCallback) window.cancelIdleCallback(handle);
  else window.clearTimeout(handle);
}

/** Writes the timeline into CSS variables (for the HTML layers) and a ref (for the 3D scene). */
function applyProgress(section: HTMLElement, state: SceneState, progress: number) {
  const phases = phasesAt(progress);
  state.progress = progress;
  state.phases = phases;
  PHASE_NAMES.forEach(name => section.style.setProperty(`--${name}`, phases[name].toFixed(4)));
  section.style.setProperty("--progress", progress.toFixed(4));
  const step = String(stepAt(progress));
  if (section.dataset.step !== step) section.dataset.step = step;
  state.requestFrame?.();
}

export function InterviewScene() {
  const root = useRef<HTMLElement>(null);
  const sticky = useRef<HTMLDivElement>(null);
  const state = useRef<SceneState>({ progress: 0, phases: phasesAt(0) });
  const htmlLayer = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage>("waiting");
  const [active, setActive] = useState(false);
  const [scrolling, setScrolling] = useState(false);

  useEffect(() => {
    const section = root.current;
    const stageElement = sticky.current;
    if (!section || !stageElement) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let current = 0;
    let frame = 0;
    let last = 0;
    let scrollIdle = 0;

    const targetProgress = () => {
      const rect = section.getBoundingClientRect();
      const travel = Math.max(1, rect.height - window.innerHeight);
      return Math.max(0, Math.min(1, -rect.top / travel));
    };
    const tick = (time: number) => {
      frame = 0;
      const target = targetProgress();
      const elapsed = last ? Math.min(64, time - last) : 16;
      last = time;
      current += (target - current) * (1 - Math.exp(-elapsed / SMOOTHING_MS));
      if (Math.abs(target - current) < SETTLE_EPSILON) current = target;
      applyProgress(section, state.current, current);
      if (current !== target) frame = requestAnimationFrame(tick);
      else last = 0;
    };
    const schedule = () => {
      if (!frame && !reduced.matches) frame = requestAnimationFrame(tick);
    };
    const configure = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      section.dataset.motion = reduced.matches ? "reduced" : "full";
      current = reduced.matches ? REDUCED_MOTION_PROGRESS : targetProgress();
      applyProgress(section, state.current, current);
    };

    // Pin directly under the sticky site header, whatever its current height.
    const header = document.querySelector<HTMLElement>(".site-header");
    const syncHeader = () => section.style.setProperty("--isc-top", `${header?.offsetHeight ?? 0}px`);
    const headerObserver = header ? new ResizeObserver(syncHeader) : null;
    if (header) headerObserver?.observe(header);
    syncHeader();

    // The section starts at the fold, so "nearly visible" is true on load. Building the 3D scene (a 1 MB
    // bundle plus WebGL setup) waits instead until the page has loaded and the visitor pauses scrolling,
    // or until the scene itself is on screen.
    let built = false;
    let idle = 0;
    let lastScroll = 0;
    const build = () => {
      if (built) return;
      built = true;
      cancelIdle(idle);
      SCREEN_IMAGES.forEach(src => { new Image().src = src; });
      setStage(supportsWebGL() ? "webgl" : "fallback");
    };
    const buildWhenQuiet = () => {
      idle = requestIdle(() => { if (performance.now() - lastScroll < QUIET_MS) buildWhenQuiet(); else build(); });
    };
    if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData !== true) {
      if (document.readyState === "complete") buildWhenQuiet();
      else window.addEventListener("load", buildWhenQuiet, { once: true });
    }
    const visibility = new IntersectionObserver(([entry]) => {
      const onScreen = entry.isIntersecting && entry.intersectionRatio >= VISIBLE_SHARE;
      if (onScreen) build();
      setActive(onScreen);
    }, { threshold: [0, VISIBLE_SHARE] });
    visibility.observe(stageElement);
    const onScroll = () => {
      lastScroll = performance.now();
      setScrolling(true);
      window.clearTimeout(scrollIdle);
      scrollIdle = window.setTimeout(() => setScrolling(false), SCROLLING_MS);
      schedule();
    };
    configure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", schedule);
    reduced.addEventListener("change", configure);
    return () => {
      cancelAnimationFrame(frame);
      cancelIdle(idle);
      window.clearTimeout(scrollIdle);
      visibility.disconnect();
      headerObserver?.disconnect();
      window.removeEventListener("load", buildWhenQuiet);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", schedule);
      reduced.removeEventListener("change", configure);
    };
  }, []);

  return (
    <section ref={root} id="see-it-work" className="isc" data-step="0" data-motion="full" data-active={active ? "true" : "false"} data-scrolling={scrolling ? "true" : "false"} aria-labelledby="isc-title">
      <div ref={sticky} className="isc-sticky">
        <div className="isc-backdrop" aria-hidden="true" />
        <div className="isc-stage" role="img" aria-label="A laptop runs a video interview. A phone on a stand beside it hears the interviewer's question, recognises it, and shows talking points from the candidate's resume.">
          {stage === "webgl" && <SceneCanvas state={state} active={active} scrolling={scrolling} portal={htmlLayer as HtmlPortal} />}
          {stage === "fallback" && <div className="isc-fallback" />}
          <div ref={htmlLayer} className="isc-html-layer" />
        </div>

        <div className="isc-overlay">
          <div className="isc-copy">
            <p className="isc-kicker"><span /> SEE IT WORK · SCROLL</p>
            <h2 id="isc-title">Laptop for the call. <em>Phone for your answers.</em></h2>
            <ol className="isc-steps">
              {STEPS.map((step, index) => (
                <li key={step.title} data-index={index}>
                  <span className="isc-step-number">0{index + 1}</span>
                  <strong>{step.title}</strong>
                  <p>{step.text}</p>
                </li>
              ))}
            </ol>
            <div className="isc-segments" aria-hidden="true">
              {STEPS.map((step, index) => <i key={step.title} style={{ "--a": step.at, "--b": STEPS[index + 1]?.at ?? 1 } as CSSProperties} />)}
            </div>
          </div>
          <div className="isc-cta">
            <Link href="/interview?view=live" className="isc-button">Try it free on your phone <ArrowRight size={18} aria-hidden="true" /></Link>
            <small><ShieldCheck size={14} aria-hidden="true" /> Use only where everyone has agreed to AI assistance.</small>
          </div>
        </div>
        <p className="isc-scroll-hint" aria-hidden="true"><span /> Scroll to play</p>
      </div>
    </section>
  );
}
