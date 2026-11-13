"use client";

import { useRef, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Grid, Html, Lightformer, Sparkles as SparkleField } from "@react-three/drei";
import { AdditiveBlending, Group, MathUtils, Mesh, MeshBasicMaterial, PerspectiveCamera, PointLight, Vector3 } from "three";
import { BookOpen, FileText, Globe, Lock, Sparkles, Zap } from "lucide-react";
import type { CSSProperties } from "react";
import { Laptop, PhoneOnStand, type HtmlPortal, type SceneState } from "./devices";
import { cameraAt, closeUpWeight, framingScale } from "./timeline";

type StateRef = RefObject<SceneState>;

const SWAY = 0.18;
/** Camera follow rate (1/s): a second, frame-rate-independent ease on top of the scroll glide. */
const CAMERA_DAMPING = 6;
const RIPPLE_COUNT = 3;
const RIPPLE_PERIOD = 1.6;
const RIPPLE_ORIGIN: [number, number, number] = [1.35, 0.01, -0.15];

type ChipSpec = { icon: typeof BookOpen; label: string; position: [number, number, number]; isSecondary?: boolean };
const CHIPS: readonly ChipSpec[] = [
  { icon: BookOpen, label: "Your knowledge", position: [-1.15, 2.75, 0.2] },
  { icon: FileText, label: "Based on your resume", position: [-1.0, 0.15, 2.7] },
  { icon: Sparkles, label: "Simple, natural answers", position: [0.55, -0.15, 2.7] },
  { icon: Zap, label: "Real-time suggestions", position: [1.1, 2.55, -0.6] },
  { icon: Globe, label: "Works in your browser", position: [2.25, 2.3, 0.0], isSecondary: true },
  { icon: Lock, label: "Your data stays yours", position: [1.85, -0.05, 2.25], isSecondary: true },
];

/* Off-centre framing as a fraction of the visible half-width/height: desktop leaves room for the
   copy on the left, mobile for the copy on top. Done by moving the camera (not setViewOffset),
   because <Html transform> layers assume a centred projection. */
const DESKTOP_SHIFT = 0.36;
const MOBILE_SHIFT = 0.2;
const COMPACT_WIDTH = 900;
/** How much closer small screens get during the phone close-up (fraction of the pull-back removed). */
const COMPACT_CLOSE_UP = 0.5;
/** Chips spread less on small screens so they stay inside the frame. */
const COMPACT_CHIP_SPREAD = 0.62;
const CHIP_CENTRE_X = 0.6;

function CameraRig({ state }: { state: StateRef }) {
  const { camera, size, pointer } = useThree();
  const look = useRef(new Vector3());
  const eye = useRef(new Vector3());
  const right = useRef(new Vector3());
  const up = useRef(new Vector3());
  const sway = useRef(new Vector3());
  const swayTarget = useRef(new Vector3());
  const smoothEye = useRef(new Vector3());
  const smoothLook = useRef(new Vector3());
  const primed = useRef(false);

  useFrame((_, delta) => {
    const shot = cameraAt(state.current.progress);
    const aspect = size.width / Math.max(1, size.height);
    const compact = size.width <= COMPACT_WIDTH;
    const pullBack = framingScale(aspect);
    const scale = compact ? pullBack * (1 - COMPACT_CLOSE_UP * closeUpWeight(state.current.progress)) : pullBack;
    look.current.set(...shot.target);
    eye.current.set(...shot.position).sub(look.current).multiplyScalar(scale).add(look.current);
    // Ease the camera toward its shot so it floats between keys instead of tracking scroll exactly.
    if (!primed.current) { smoothEye.current.copy(eye.current); smoothLook.current.copy(look.current); primed.current = true; }
    const follow = 1 - Math.exp(-Math.min(delta, 0.1) * CAMERA_DAMPING);
    smoothEye.current.lerp(eye.current, follow);
    smoothLook.current.lerp(look.current, follow);
    eye.current.copy(smoothEye.current);
    look.current.copy(smoothLook.current);

    // Visible half-extent at the target distance, then shift camera + target together.
    const distance = eye.current.distanceTo(look.current);
    const halfHeight = Math.tan(MathUtils.degToRad((camera as PerspectiveCamera).fov / 2)) * distance;
    camera.position.copy(eye.current);
    camera.lookAt(look.current);
    right.current.setFromMatrixColumn(camera.matrix, 0);
    up.current.setFromMatrixColumn(camera.matrix, 1);
    const shiftX = compact ? 0 : -halfHeight * aspect * DESKTOP_SHIFT;
    const shiftY = compact ? halfHeight * MOBILE_SHIFT : 0;

    swayTarget.current.set(pointer.x * SWAY, pointer.y * SWAY * 0.5, 0);
    sway.current.lerp(swayTarget.current, 1 - Math.exp(-delta * 2.5));
    const offset = right.current.multiplyScalar(shiftX + sway.current.x).add(up.current.multiplyScalar(shiftY + sway.current.y));
    camera.position.add(offset);
    look.current.add(offset);
    camera.lookAt(look.current);
  });
  return null;
}

/** Sound ripples spreading from the laptop speaker toward the phone while the question is spoken. */
function SoundRipples({ state }: { state: StateRef }) {
  const group = useRef<Group>(null);
  useFrame(({ clock }) => {
    const { ask, detect } = state.current.phases;
    const strength = Math.min(1, ask * 6) * (1 - detect);
    if (!group.current) return;
    group.current.visible = strength > 0.01;
    group.current.children.forEach((child, index) => {
      const t = ((clock.elapsedTime / RIPPLE_PERIOD) + index / RIPPLE_COUNT) % 1;
      const ring = child as Mesh;
      ring.scale.setScalar(0.25 + t * 2.4);
      (ring.material as MeshBasicMaterial).opacity = (1 - t) * 0.55 * strength;
    });
  });
  return (
    <group ref={group} position={RIPPLE_ORIGIN} visible={false}>
      {Array.from({ length: RIPPLE_COUNT }, (_, index) => (
        <mesh key={index} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[0.46, 0.5, 96]} />
          <meshBasicMaterial color="#7fe0ae" transparent depthWrite={false} blending={AdditiveBlending} />
        </mesh>
      ))}
    </group>
  );
}

function ScreenGlow({ state }: { state: StateRef }) {
  const light = useRef<PointLight>(null);
  useFrame(() => {
    if (light.current) light.current.intensity = state.current.phases.screen * 1.1;
  });
  return <pointLight ref={light} position={[0, 1.2, 0.5]} color="#e8eef2" distance={3} decay={2} intensity={0} />;
}

function Chips({ portal }: { portal: HtmlPortal }) {
  const compact = useThree(three => three.size.width <= COMPACT_WIDTH);
  const spread = compact ? COMPACT_CHIP_SPREAD : 1;
  return (
    <>
      {CHIPS.filter(chip => !(compact && chip.isSecondary)).map(({ icon: Icon, label, position }, index) => (
        <Html key={label} position={[CHIP_CENTRE_X + (position[0] - CHIP_CENTRE_X) * spread, position[1], position[2]]} center portal={portal} zIndexRange={[25, 21]} className="isc-chip-anchor">
          <div className="isc-chip" style={{ "--i": index } as CSSProperties}>
            <span><Icon size={16} aria-hidden="true" /></span>{label}
          </div>
        </Html>
      ))}
    </>
  );
}

/** Glowing floor grid fading into the dark, plus slow drifting light particles. */
function Atmosphere() {
  return (
    <>
      <Grid
        position={[0.6, -0.004, 0]}
        args={[40, 40]}
        infiniteGrid
        cellSize={0.5}
        cellThickness={0.6}
        cellColor="#24583f"
        sectionSize={2.5}
        sectionThickness={1.1}
        sectionColor="#3b9a6b"
        fadeDistance={24}
        fadeStrength={2.2}
      />
      <SparkleField count={70} scale={[14, 6, 10]} position={[0.6, 2.4, -1]} size={2.2} speed={0.25} opacity={0.45} color="#9be8bf" noise={0.6} />
    </>
  );
}

function Studio() {
  return (
    <Environment resolution={256} frames={1}>
      <Lightformer form="rect" intensity={2.4} position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[10, 6, 1]} />
      <Lightformer form="rect" intensity={3} position={[-6, 2, 3]} rotation-y={Math.PI / 2} scale={[8, 1.2, 1]} />
      <Lightformer form="rect" intensity={2} position={[6, 2.5, -1]} rotation-y={-Math.PI / 2} scale={[8, 1, 1]} />
      <Lightformer form="rect" intensity={0.6} position={[0, 2, -7]} scale={[12, 2, 1]} />
      <Lightformer form="rect" intensity={0.7} position={[0, 1, 8]} rotation-y={Math.PI} scale={[10, 4, 1]} />
    </Environment>
  );
}

type Props = { state: StateRef; active: boolean; portal: HtmlPortal };

export default function SceneCanvas({ state, active, portal }: Props) {
  return (
    <Canvas
      className="isc-canvas"
      frameloop={active ? "always" : "never"}
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      camera={{ fov: 30, near: 0.1, far: 60, position: [5.6, 6.4, 7.6] }}
    >
      <ambientLight intensity={0.25} />
      <directionalLight position={[4, 7, 5]} intensity={1.1} />
      <Studio />
      <CameraRig state={state} />
      <group>
        <Laptop state={state} />
        <PhoneOnStand state={state} />
        <SoundRipples state={state} />
        <ScreenGlow state={state} />
        <Chips portal={portal} />
      </group>
      <ContactShadows position-y={0} scale={14} blur={2.6} far={3} opacity={0.75} resolution={256} color="#000000" />
      <Atmosphere />
    </Canvas>
  );
}
