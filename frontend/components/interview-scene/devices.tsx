"use client";

import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import { Group, InstancedMesh, Matrix4 } from "three";
import { CALL_PHASES, CALL_SIZE, callIsAnimating, paintCall } from "./paint-call";
import { PHONE_PHASES, PHONE_SIZE, paintPhone, phoneIsAnimating } from "./paint-phone";
import { screenImage } from "./paint-utils";
import { ScreenSurface, type ScreenPainter } from "./screen-surface";
import { easeOutBack, type Phases } from "./timeline";

export type SceneState = {
  progress: number;
  phases: Phases;
  /** Ask the WebGL canvas for one more frame (used with frameloop="demand" while the visitor scrolls). */
  requestFrame?: () => void;
};
/** Fixed container for the floating <Html> chips. Without it drei re-targets mid-mount and drops a layer. */
export type HtmlPortal = RefObject<HTMLElement>;
type StateRef = RefObject<SceneState>;
type DeviceProps = { state: StateRef };

/* World units are roughly decimetres. Screen planes keep the painter's aspect ratio exactly. */
const LAPTOP = { width: 3.1, depth: 2.15, baseHeight: 0.06, lidHeight: 2.05, lidDepth: 0.04 };
const LAPTOP_SCREEN_WIDTH = 2.86;
const LAPTOP_SCREEN: [number, number] = [LAPTOP_SCREEN_WIDTH, (LAPTOP_SCREEN_WIDTH * CALL_SIZE.height) / CALL_SIZE.width];
const PHONE = { width: 0.72, height: 1.48, depth: 0.075 };
const PHONE_SCREEN_WIDTH = 0.672;
const PHONE_SCREEN: [number, number] = [PHONE_SCREEN_WIDTH, (PHONE_SCREEN_WIDTH * PHONE_SIZE.height) / PHONE_SIZE.width];
const COMPACT_WIDTH = 900;
const ANIMATION_FPS = 24;
const IMAGES = { interviewer: "/scene/interviewer.webp", candidate: "/scene/candidate.webp" };
const LID_CLOSED = Math.PI / 2;
const LID_OPEN = -0.27;
const KEY_COLUMNS = 14;
const KEY_ROWS = 5;
const KEY_PITCH = 0.185;

const ALUMINIUM = { color: "#7d838a", metalness: 1, roughness: 0.34 } as const;
const DARK_GLASS = { color: "#050607", metalness: 0.2, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05 } as const;

function Keyboard() {
  const keys = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = keys.current;
    if (!mesh) return;
    const matrix = new Matrix4();
    let index = 0;
    for (let row = 0; row < KEY_ROWS; row += 1) {
      for (let column = 0; column < KEY_COLUMNS; column += 1) {
        const x = (column - (KEY_COLUMNS - 1) / 2) * KEY_PITCH;
        const z = (row - (KEY_ROWS - 1) / 2) * KEY_PITCH;
        mesh.setMatrixAt(index, matrix.makeTranslation(x, 0, z));
        index += 1;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, []);
  return (
    <group position={[0, LAPTOP.baseHeight + 0.004, -0.42]}>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.003}>
        <planeGeometry args={[KEY_COLUMNS * KEY_PITCH + 0.08, KEY_ROWS * KEY_PITCH + 0.08]} />
        <meshStandardMaterial color="#202326" roughness={0.6} metalness={0.4} />
      </mesh>
      <instancedMesh ref={keys} args={[undefined, undefined, KEY_COLUMNS * KEY_ROWS]}>
        <boxGeometry args={[0.158, 0.012, 0.152]} />
        <meshStandardMaterial color="#111316" roughness={0.55} />
      </instancedMesh>
    </group>
  );
}

/** Thin glossy layer over a display: picks up studio reflections like real glass. */
function Glass({ size, z }: { size: [number, number]; z: number }) {
  return (
    <mesh position-z={z}>
      <planeGeometry args={size} />
      <meshPhysicalMaterial color="#ffffff" transparent opacity={0.07} roughness={0.04} metalness={0} clearcoat={1} depthWrite={false} />
    </mesh>
  );
}

export function Laptop({ state }: DeviceProps) {
  const lid = useRef<Group>(null);
  const compact = useThree(three => three.size.width <= COMPACT_WIDTH);
  const [imageVersion, setImageVersion] = useState(0);
  const paint = useMemo<ScreenPainter>(() => {
    const onLoad = () => setImageVersion(version => version + 1);
    const images = { interviewer: screenImage(IMAGES.interviewer, onLoad), candidate: screenImage(IMAGES.candidate, onLoad) };
    return (ctx, phases, time) => paintCall(ctx, phases, time, images);
  }, []);
  useFrame(() => {
    if (!lid.current) return;
    const open = state.current.phases.lid;
    lid.current.rotation.x = LID_CLOSED + (LID_OPEN - LID_CLOSED) * open;
  });

  return (
    <group>
      <RoundedBox args={[LAPTOP.width, LAPTOP.baseHeight, LAPTOP.depth]} radius={0.028} smoothness={4} position-y={LAPTOP.baseHeight / 2}>
        <meshPhysicalMaterial {...ALUMINIUM} />
      </RoundedBox>
      <Keyboard />
      <mesh rotation-x={-Math.PI / 2} position={[0, LAPTOP.baseHeight + 0.002, 0.6]}>
        <planeGeometry args={[1.3, 0.78]} />
        <meshPhysicalMaterial color="#757b82" metalness={0.9} roughness={0.24} />
      </mesh>

      {/* Hinge group: rotation.x opens the lid around the back edge of the base. */}
      <group ref={lid} position={[0, LAPTOP.baseHeight + LAPTOP.lidDepth / 2, -LAPTOP.depth / 2 + 0.03]} rotation-x={LID_CLOSED}>
        <RoundedBox args={[LAPTOP.width, LAPTOP.lidHeight, LAPTOP.lidDepth]} radius={0.02} smoothness={4} position-y={LAPTOP.lidHeight / 2}>
          <meshPhysicalMaterial {...ALUMINIUM} />
        </RoundedBox>
        <mesh position={[0, LAPTOP.lidHeight / 2, LAPTOP.lidDepth / 2 + 0.001]}>
          <planeGeometry args={[LAPTOP.width - 0.06, LAPTOP.lidHeight - 0.06]} />
          <meshPhysicalMaterial {...DARK_GLASS} />
        </mesh>
        <mesh position={[0, LAPTOP.lidHeight - 0.075, LAPTOP.lidDepth / 2 + 0.002]}>
          <circleGeometry args={[0.012, 16]} />
          <meshBasicMaterial color="#1d2a24" />
        </mesh>
        <group position={[0, LAPTOP.lidHeight / 2 + 0.02, 0]}>
          <ScreenSurface
            state={state}
            paint={paint}
            watches={CALL_PHASES}
            pixels={CALL_SIZE}
            resolution={compact ? 1 : 1.25}
            size={LAPTOP_SCREEN}
            position={[0, 0, LAPTOP.lidDepth / 2 + 0.003]}
            animationFps={(phases: Phases) => (callIsAnimating(phases) ? ANIMATION_FPS : 0)}
            version={imageVersion}
          />
          <Glass size={LAPTOP_SCREEN} z={LAPTOP.lidDepth / 2 + 0.005} />
        </group>
      </group>
    </group>
  );
}

/** Phone on a desk stand. It drops in from above and settles with a slight overshoot. */
export function PhoneOnStand({ state }: DeviceProps) {
  const phone = useRef<Group>(null);
  const compact = useThree(three => three.size.width <= COMPACT_WIDTH);
  useFrame(() => {
    if (!phone.current) return;
    const t = state.current.phases.phone;
    const landed = t <= 0 ? 0 : easeOutBack(t);
    const away = 1 - landed;
    phone.current.visible = t > 0.001;
    phone.current.position.set(0.9 * away, 0.86 + 3.4 * away, 0.95 * away);
    phone.current.rotation.set(-0.22 - 1.1 * away, 0.9 * away, -0.7 * away);
  });

  return (
    <group position={[2.35, 0, 0.5]} rotation-y={0.38}>
      <RoundedBox args={[0.86, 0.035, 0.62]} radius={0.016} position={[0, 0.0175, 0.05]}>
        <meshPhysicalMaterial color="#2a302d" metalness={0.85} roughness={0.35} />
      </RoundedBox>
      <RoundedBox args={[0.5, 1.05, 0.03]} radius={0.012} position={[0, 0.5, -0.22]} rotation-x={-0.22}>
        <meshPhysicalMaterial color="#2a302d" metalness={0.85} roughness={0.35} />
      </RoundedBox>
      <group ref={phone} visible={false}>
        <RoundedBox args={[PHONE.width, PHONE.height, PHONE.depth]} radius={0.075} smoothness={6}>
          <meshPhysicalMaterial color="#30353a" metalness={1} roughness={0.28} />
        </RoundedBox>
        <mesh position-z={PHONE.depth / 2 + 0.001}>
          <planeGeometry args={[PHONE.width - 0.03, PHONE.height - 0.03]} />
          <meshPhysicalMaterial {...DARK_GLASS} />
        </mesh>
        <ScreenSurface
          state={state}
          paint={paintPhone}
          watches={PHONE_PHASES}
          pixels={PHONE_SIZE}
          resolution={compact ? 1.6 : 2}
          size={PHONE_SCREEN}
          position={[0, 0, PHONE.depth / 2 + 0.003]}
          animationFps={(phases: Phases) => (phoneIsAnimating(phases) ? ANIMATION_FPS : 0)}
          isTransparent
        />
        <Glass size={PHONE_SCREEN} z={PHONE.depth / 2 + 0.005} />
      </group>
    </group>
  );
}
