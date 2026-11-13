"use client";

import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { CanvasTexture, SRGBColorSpace } from "three";
import type { Phases } from "./timeline";

type SceneStateLike = { progress: number; phases: Phases };

export type ScreenPainter = (ctx: CanvasRenderingContext2D, phases: Phases, time: number) => void;

type Props = {
  state: RefObject<SceneStateLike>;
  paint: ScreenPainter;
  /** Logical (CSS-pixel) size the painter draws in. */
  pixels: { width: number; height: number };
  /** Device pixels per logical pixel — higher keeps text sharp in close-ups. */
  resolution: number;
  /** Size of the screen in world units. */
  size: [number, number];
  position?: [number, number, number];
  /** Frames per second for self-animating content (0 = repaint only when the scroll phase changes). */
  animationFps: (phases: Phases) => number;
  /** Bump to force a repaint (e.g. after an image finishes loading). */
  version?: number;
  isTransparent?: boolean;
};

const PHASE_PRECISION = 3;

/** Tells three.js to re-upload the canvas to the GPU on the next render. */
function queueUpload(map: CanvasTexture) {
  map.needsUpdate = true;
}

/**
 * A screen painted with Canvas 2D and mapped onto a plane as a texture, so it is part of the 3D scene:
 * perfectly aligned to its device, correctly occluded, and lit by nothing (it is emissive, like a real display).
 */
export function ScreenSurface({ state, paint, pixels, resolution, size, position, animationFps, version = 0, isTransparent = false }: Props) {
  const { canvas, texture } = useMemo(() => {
    const element = document.createElement("canvas");
    element.width = Math.round(pixels.width * resolution);
    element.height = Math.round(pixels.height * resolution);
    const map = new CanvasTexture(element);
    map.colorSpace = SRGBColorSpace;
    map.anisotropy = 8;
    return { canvas: element, texture: map };
  }, [pixels.width, pixels.height, resolution]);
  const lastKey = useRef("");

  useEffect(() => () => texture.dispose(), [texture]);
  useEffect(() => { lastKey.current = ""; }, [version]);

  useFrame(({ clock }) => {
    const { phases } = state.current;
    const fps = animationFps(phases);
    const tick = fps > 0 ? Math.floor(clock.elapsedTime * fps) : 0;
    const key = `${Object.values(phases).map(value => value.toFixed(PHASE_PRECISION)).join(",")}|${tick}|${version}`;
    if (key === lastKey.current) return;
    lastKey.current = key;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(resolution, 0, 0, resolution, 0, 0);
    paint(ctx, phases, clock.elapsedTime);
    queueUpload(texture);
  });

  return (
    <mesh position={position}>
      <planeGeometry args={size} />
      <meshBasicMaterial map={texture} toneMapped={false} transparent={isTransparent} />
    </mesh>
  );
}
