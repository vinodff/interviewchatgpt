/**
 * Scroll timeline for the interview scene.
 * Everything is a pure function of scroll progress (0–1) so the scene is fully scrubbable.
 */

export type Vec3 = readonly [number, number, number];
export type PhaseName = "lid" | "screen" | "phone" | "ask" | "listen" | "transcript" | "detect" | "answer" | "source" | "chips";
export type Phases = Record<PhaseName, number>;
export type CameraKey = { at: number; position: Vec3; target: Vec3 };
export type Step = { at: number; title: string; text: string };

export const PHASE_WINDOWS: Readonly<Record<PhaseName, readonly [number, number]>> = {
  lid: [0.04, 0.17],
  screen: [0.13, 0.2],
  phone: [0.18, 0.31],
  ask: [0.34, 0.46],
  listen: [0.34, 0.37],
  transcript: [0.37, 0.49],
  detect: [0.49, 0.53],
  answer: [0.55, 0.76],
  source: [0.74, 0.78],
  chips: [0.83, 0.96],
};

export const STEPS: readonly Step[] = [
  { at: 0, title: "Join the interview on your laptop.", text: "Zoom, Google Meet or Teams. The call runs exactly as it normally does." },
  { at: 0.18, title: "Open InterviewWin on your phone.", text: "No app to install. Open it in your phone’s browser, pick your role and tap start." },
  { at: 0.33, title: "The interviewer asks a question.", text: "Your phone’s microphone hears it through the laptop speaker and transcribes it live." },
  { at: 0.48, title: "The question is recognised automatically.", text: "No typing, no copy-paste. It knows when a question ends and what kind of question it is." },
  { at: 0.54, title: "Your answer streams in.", text: "Clear talking points built from your own resume and projects, ready to glance at." },
  { at: 0.8, title: "Built from you.", text: "Your knowledge and your experience, said in your own words." },
];

/** Camera path. Each segment eases in and out, so the camera settles on every shot. */
export const CAMERA_KEYS: readonly CameraKey[] = [
  { at: 0, position: [5.6, 6.4, 7.6], target: [0.5, 0.4, 0] },
  { at: 0.17, position: [0.9, 2.7, 7.4], target: [0.55, 0.95, 0] },
  { at: 0.31, position: [2.0, 2.4, 7.1], target: [1.05, 0.95, 0.1] },
  { at: 0.42, position: [-0.25, 1.9, 4.9], target: [0.05, 1.05, -0.8] },
  { at: 0.52, position: [3.95, 1.6, 3.75], target: [2.3, 0.86, 0.55] },
  { at: 0.8, position: [3.7, 1.5, 3.45], target: [2.3, 0.86, 0.55] },
  { at: 1, position: [1.2, 3.3, 8.8], target: [0.7, 0.85, 0] },
];

export const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

/** Overshoots slightly before settling — used for the phone landing on its stand. */
export const easeOutBack = (t: number): number => {
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

export function windowProgress(progress: number, [start, end]: readonly [number, number]): number {
  if (end <= start) return progress >= end ? 1 : 0;
  return clamp01((progress - start) / (end - start));
}

export function phasesAt(progress: number): Phases {
  const entries = (Object.keys(PHASE_WINDOWS) as PhaseName[]).map(name => {
    const linear = windowProgress(progress, PHASE_WINDOWS[name]);
    // Word-by-word reveals read best at a constant rate; motion phases are eased.
    const isLinear = name === "ask" || name === "transcript" || name === "answer";
    return [name, isLinear ? linear : easeOutCubic(linear)] as const;
  });
  return Object.fromEntries(entries) as Phases;
}

export function stepAt(progress: number): number {
  return STEPS.reduce((current, step, index) => (progress >= step.at ? index : current), 0);
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerpVec = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

export function cameraAt(progress: number, keys: readonly CameraKey[] = CAMERA_KEYS): { position: Vec3; target: Vec3 } {
  const p = clamp01(progress);
  const nextIndex = keys.findIndex(key => key.at >= p);
  if (nextIndex <= 0) return { position: keys[0].position, target: keys[0].target };
  const from = keys[nextIndex - 1];
  const to = keys[nextIndex];
  const t = easeInOutCubic(windowProgress(p, [from.at, to.at]));
  return { position: lerpVec(from.position, to.position, t), target: lerpVec(from.target, to.target, t) };
}

/** 0→1→0 weight for the phone close-up shots; small screens push in further while it is up. */
export function closeUpWeight(progress: number): number {
  return easeInOutCubic(windowProgress(progress, [0.44, 0.52])) * (1 - easeInOutCubic(windowProgress(progress, [0.8, 0.88])));
}

/** Narrow (portrait) viewports pull the camera back so the whole shot still fits. */
export function framingScale(aspect: number): number {
  const reference = 1.5;
  if (aspect >= reference) return 1;
  return Math.min(2.6, Math.pow(reference / Math.max(aspect, 0.3), 0.85));
}
