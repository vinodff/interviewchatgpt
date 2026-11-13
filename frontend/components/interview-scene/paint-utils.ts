/** Canvas 2D helpers shared by the screen painters. Screens are textures, so they stay glued to the 3D devices. */

export const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';

export const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export type PlacedWord = { text: string; x: number; y: number; index: number };
export type WordLayout = { words: PlacedWord[]; lineCount: number };

/** Wraps text into lines. Positions are relative to (0, 0); `index` continues from `startIndex`. */
export function layoutWords(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, lineHeight: number, startIndex = 0): WordLayout {
  const space = ctx.measureText(" ").width;
  const words: PlacedWord[] = [];
  let x = 0;
  let line = 0;
  text.split(" ").forEach((word, offset) => {
    const width = ctx.measureText(word).width;
    if (x > 0 && x + width > maxWidth) {
      x = 0;
      line += 1;
    }
    words.push({ text: word, x, y: line * lineHeight, index: startIndex + offset });
    x += width + space;
  });
  return { words, lineCount: words.length ? line + 1 : 0 };
}

/** Draws words that fade in one by one: word `i` is fully visible once `reveal` passes i + 1. */
export function drawWords(ctx: CanvasRenderingContext2D, layout: WordLayout, originX: number, originY: number, reveal: number) {
  const baseAlpha = ctx.globalAlpha;
  layout.words.forEach(word => {
    const alpha = clamp01(reveal - word.index);
    if (alpha <= 0) return;
    ctx.globalAlpha = baseAlpha * alpha;
    ctx.fillText(word.text, originX + word.x, originY + word.y);
  });
  ctx.globalAlpha = baseAlpha;
}

export function fillRound(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number, fill: string | CanvasGradient) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function strokeRound(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number, stroke: string, lineWidth: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

/** object-fit: cover into a rounded rectangle, with an optional zoom around the centre. */
export function drawCover(ctx: CanvasRenderingContext2D, image: HTMLImageElement | undefined, x: number, y: number, width: number, height: number, radius: number, zoom = 1) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.clip();
  ctx.fillStyle = "#1d2224";
  ctx.fillRect(x, y, width, height);
  if (image && image.complete && image.naturalWidth > 0) {
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight) * zoom;
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
  }
  ctx.restore();
}

/** Small animated level bars (speaking / microphone meters). */
export function drawBars(ctx: CanvasRenderingContext2D, x: number, centerY: number, count: number, barWidth: number, gap: number, maxHeight: number, color: string, time: number, isActive: boolean) {
  ctx.fillStyle = color;
  for (let index = 0; index < count; index += 1) {
    const level = isActive ? 0.3 + 0.7 * Math.abs(Math.sin(time * 7 + index * 1.7)) : 0.25;
    const height = Math.max(2, maxHeight * level);
    ctx.beginPath();
    ctx.roundRect(x + index * (barWidth + gap), centerY - height / 2, barWidth, height, barWidth / 2);
    ctx.fill();
  }
}

const imageCache = new Map<string, HTMLImageElement>();

/** Starts loading once per URL; painters check `complete` and the surface repaints when it loads. */
export function screenImage(src: string, onLoad: () => void): HTMLImageElement {
  const cached = imageCache.get(src);
  if (cached) return cached;
  const image = new Image();
  image.decoding = "async";
  image.onload = onLoad;
  image.src = src;
  imageCache.set(src, image);
  return image;
}
