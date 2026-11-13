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

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
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
}

export function InterviewScene() {
  const root = useRef<HTMLElement>(null);
  const state = useRef<SceneState>({ progress: 0, phases: phasesAt(0) });
  const htmlLayer = useRef<HTMLDivElement>(null);
  const [canRender3D, setCanRender3D] = useState(false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const section = root.current;
    if (!section) return;
    setCanRender3D(supportsWebGL());
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let current = 0;
    let frame = 0;
    let last = 0;

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

    let preloaded = false;
    const visibility = new IntersectionObserver(([entry]) => {
      setActive(entry.isIntersecting);
      if (entry.isIntersecting && !preloaded) {
        preloaded = true;
        SCREEN_IMAGES.forEach(src => { new Image().src = src; });
      }
    }, { rootMargin: "600px 0px" });
    visibility.observe(section);
    configure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    reduced.addEventListener("change", configure);
    return () => {
      cancelAnimationFrame(frame);
      visibility.disconnect();
      headerObserver?.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      reduced.removeEventListener("change", configure);
    };
  }, []);

  return (
    <section ref={root} id="see-it-work" className="isc" data-step="0" data-motion="full" aria-labelledby="isc-title">
      <div className="isc-sticky">
        <div className="isc-backdrop" aria-hidden="true" />
        <div className="isc-stage" role="img" aria-label="A laptop runs a video interview. A phone on a stand beside it hears the interviewer's question, recognises it, and shows talking points from the candidate's resume.">
          {canRender3D ? <SceneCanvas state={state} active={active} portal={htmlLayer as HtmlPortal} /> : <div className="isc-fallback" />}
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
