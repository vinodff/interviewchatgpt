import type { PhaseName, Phases } from "./timeline";
import { INTERVIEWER, MEETING_TITLE, QUESTION, QUESTION_WORD_COUNT } from "./script";
import { SANS, clamp01, drawBars, drawCover, drawWords, fillRound, layoutWords, strokeRound } from "./paint-utils";

/** Video-call UI painted onto the laptop screen texture (CSS-pixel units; the surface scales for sharpness). */
export const CALL_SIZE = { width: 1144, height: 716 } as const;
/** Every phase paintCall reads. The screen is repainted (and re-uploaded) only when one of these changes. */
export const CALL_PHASES: readonly PhaseName[] = ["screen", "ask", "detect", "answer"];

const TOP_BAR = 54;
const BOTTOM_BAR = 70;
const TILE_INSET = 14;
const CAPTION_LINE = 34;

export type CallImages = { interviewer?: HTMLImageElement; candidate?: HTMLImageElement };

const speakingLevel = (phases: Phases) => clamp01(phases.ask * 25) * (1 - phases.detect);

/** True while something on the call screen moves on its own (speaking bars, outline). */
export const callIsAnimating = (phases: Phases): boolean => speakingLevel(phases) > 0.01;

function paintTopBar(ctx: CanvasRenderingContext2D) {
  const { width } = CALL_SIZE;
  ctx.fillStyle = "#16191b";
  ctx.fillRect(0, 0, width, TOP_BAR);
  ctx.textBaseline = "middle";
  ctx.font = `500 17px ${SANS}`;
  ctx.fillStyle = "#e4ebe7";
  strokeRound(ctx, 22, 20, 18, 13, 3, "#aab5b0", 1.6);
  ctx.fillText(MEETING_TITLE, 52, TOP_BAR / 2);
  ctx.fillStyle = "#ef5a4c";
  ctx.beginPath();
  ctx.arc(width - 168, TOP_BAR / 2, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#aab5b0";
  ctx.font = `500 16px ${SANS}`;
  ctx.fillText("24:18", width - 156, TOP_BAR / 2);
  ctx.fillText("2 people", width - 92, TOP_BAR / 2);
}

function paintControls(ctx: CanvasRenderingContext2D) {
  const { width, height } = CALL_SIZE;
  const top = height - BOTTOM_BAR;
  ctx.fillStyle = "#16191b";
  ctx.fillRect(0, top, width, BOTTOM_BAR);
  const centerY = top + BOTTOM_BAR / 2;
  const startX = width / 2 - 120;
  [0, 1, 2].forEach(index => {
    ctx.fillStyle = "#2a3033";
    ctx.beginPath();
    ctx.arc(startX + index * 60, centerY, 23, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#dfe6e2";
    fillRound(ctx, startX + index * 60 - 7, centerY - 7, 14, 14, index === 0 ? 7 : 3, "#dfe6e2");
  });
  fillRound(ctx, startX + 160, centerY - 23, 70, 46, 23, "#d9473a");
  fillRound(ctx, startX + 180, centerY - 4, 30, 8, 4, "#ffffff");
}

function paintCaption(ctx: CanvasRenderingContext2D, phases: Phases, tileBottom: number) {
  const alpha = clamp01(phases.ask * 25) * (1 - phases.answer);
  if (alpha <= 0.01) return;
  const boxWidth = 820;
  const boxX = (CALL_SIZE.width - boxWidth) / 2;
  ctx.font = `400 25px ${SANS}`;
  const layout = layoutWords(ctx, QUESTION, boxWidth - 44, CAPTION_LINE);
  const boxHeight = 52 + layout.lineCount * CAPTION_LINE;
  const boxY = tileBottom - 70 - boxHeight;
  ctx.save();
  ctx.globalAlpha = alpha;
  fillRound(ctx, boxX, boxY, boxWidth, boxHeight, 14, "rgba(0, 0, 0, 0.74)");
  ctx.textBaseline = "top";
  ctx.font = `700 14px ${SANS}`;
  ctx.fillStyle = "#8fe0b4";
  ctx.fillText(INTERVIEWER.name.toUpperCase(), boxX + 22, boxY + 16);
  ctx.font = `400 25px ${SANS}`;
  ctx.fillStyle = "#ffffff";
  drawWords(ctx, layout, boxX + 22, boxY + 40, phases.ask * QUESTION_WORD_COUNT);
  ctx.restore();
}

export function paintCall(ctx: CanvasRenderingContext2D, phases: Phases, time: number, images: CallImages) {
  const { width, height } = CALL_SIZE;
  ctx.fillStyle = "#0f1213";
  ctx.fillRect(0, 0, width, height);
  paintTopBar(ctx);

  const tileX = TILE_INSET;
  const tileY = TOP_BAR + TILE_INSET;
  const tileWidth = width - TILE_INSET * 2;
  const tileHeight = height - TOP_BAR - BOTTOM_BAR - TILE_INSET * 2;
  drawCover(ctx, images.interviewer, tileX, tileY, tileWidth, tileHeight, 14, 1.04 - phases.ask * 0.04);

  const speaking = speakingLevel(phases);
  if (speaking > 0.01) strokeRound(ctx, tileX + 1.5, tileY + 1.5, tileWidth - 3, tileHeight - 3, 13, `rgba(95, 211, 148, ${speaking})`, 3);

  // Name tag with live speaking bars.
  ctx.font = `500 16px ${SANS}`;
  const nameText = `${INTERVIEWER.name} · ${INTERVIEWER.role}`;
  const tagWidth = ctx.measureText(nameText).width + 52;
  fillRound(ctx, tileX + 14, tileY + tileHeight - 50, tagWidth, 36, 9, "rgba(0, 0, 0, 0.62)");
  drawBars(ctx, tileX + 28, tileY + tileHeight - 32, 3, 3, 2, 14, "#5fd394", time, speaking > 0.01);
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(nameText, tileX + 50, tileY + tileHeight - 32);

  // Self view.
  const selfX = width - 30 - 236;
  const selfY = tileY + 16;
  drawCover(ctx, images.candidate, selfX, selfY, 236, 152, 12);
  strokeRound(ctx, selfX, selfY, 236, 152, 12, "rgba(255, 255, 255, 0.22)", 2);
  fillRound(ctx, selfX + 10, selfY + 120, 44, 24, 6, "rgba(0, 0, 0, 0.6)");
  ctx.font = `500 13px ${SANS}`;
  ctx.fillStyle = "#ffffff";
  ctx.fillText("You", selfX + 19, selfY + 132);

  paintCaption(ctx, phases, tileY + tileHeight);
  paintControls(ctx);

  // Screen wakes up: content fades in from black.
  const off = 1 - phases.screen;
  if (off > 0) {
    ctx.fillStyle = `rgba(0, 0, 0, ${off})`;
    ctx.fillRect(0, 0, width, height);
  }
}
