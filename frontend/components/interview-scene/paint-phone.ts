import type { PhaseName, Phases } from "./timeline";
import { ANSWER_PARTS, ANSWER_PART_STARTS, ANSWER_TITLE, ANSWER_WORD_COUNT, QUESTION, QUESTION_TYPE, QUESTION_WORD_COUNT, SOURCES } from "./script";
import { SANS, clamp01, drawBars, drawWords, fillRound, layoutWords, strokeRound } from "./paint-utils";

/** InterviewWin phone app painted onto the phone screen texture (CSS-pixel units). */
export const PHONE_SIZE = { width: 330, height: 700, radius: 44 } as const;
/** Every phase paintPhone reads. The screen is repainted (and re-uploaded) only when one of these changes. */
export const PHONE_PHASES: readonly PhaseName[] = ["ask", "detect", "transcript", "answer", "source"];

const PAD = 12;
const PANEL_WIDTH = PHONE_SIZE.width - PAD * 2;
const TRANSCRIPT_LINE = 21;
const ANSWER_LINE = 19;
const INK = "#173b30";
const GREEN = "#12614a";
const LABEL = "#4f7a62";

const isListening = (phases: Phases) => phases.ask > 0 && phases.detect < 1;

/** True while something on the phone moves on its own (mic meter while listening). */
export const phoneIsAnimating = (phases: Phases): boolean => isListening(phases);

function panel(ctx: CanvasRenderingContext2D, y: number, height: number) {
  ctx.save();
  ctx.shadowColor = "rgba(23, 59, 48, 0.12)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  fillRound(ctx, PAD, y, PANEL_WIDTH, height, 18, "#ffffff");
  ctx.restore();
  strokeRound(ctx, PAD + 0.5, y + 0.5, PANEL_WIDTH - 1, height - 1, 18, "#e1e9df", 1);
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number) {
  ctx.font = `700 10.5px ${SANS}`;
  ctx.fillStyle = LABEL;
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
}

function paintChrome(ctx: CanvasRenderingContext2D) {
  const { width } = PHONE_SIZE;
  ctx.textBaseline = "middle";
  ctx.font = `600 14px ${SANS}`;
  ctx.fillStyle = INK;
  ctx.fillText("9:41", 30, 24);
  fillRound(ctx, width / 2 - 48, 10, 96, 28, 14, "#070808");
  strokeRound(ctx, width - 54, 18, 24, 12, 3, INK, 1.5);
  fillRound(ctx, width - 51.5, 20.5, 16, 7, 1.5, INK);

  drawBars(ctx, 18, 66, 4, 2.5, 2, 14, GREEN, 0, true);
  ctx.font = `700 16px ${SANS}`;
  ctx.fillStyle = GREEN;
  ctx.fillText("InterviewWin", 40, 66);
  fillRound(ctx, width - 108, 54, 92, 24, 12, "#fde9e6");
  ctx.fillStyle = "#e2483a";
  ctx.beginPath();
  ctx.arc(width - 95, 66, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `700 10.5px ${SANS}`;
  ctx.fillStyle = "#b2382c";
  ctx.fillText("LIVE 24:18", width - 86, 66);
}

/** Returns the y coordinate below the transcript panel. */
function paintTranscript(ctx: CanvasRenderingContext2D, phases: Phases, time: number, top: number): number {
  ctx.font = `400 14.5px ${SANS}`;
  const layout = layoutWords(ctx, QUESTION, PANEL_WIDTH - 28, TRANSCRIPT_LINE);
  const height = Math.max(112, 46 + layout.lineCount * TRANSCRIPT_LINE + 10);
  panel(ctx, top, height);
  label(ctx, "LIVE TRANSCRIPT", PAD + 14, top + 20);
  drawBars(ctx, PHONE_SIZE.width - PAD - 44, top + 20, 5, 3, 2, 12, "#5fbf8a", time, isListening(phases));

  ctx.textBaseline = "top";
  const idle = 1 - clamp01(phases.transcript * 30);
  if (idle > 0) {
    ctx.save();
    ctx.globalAlpha = idle;
    ctx.font = `400 14px ${SANS}`;
    ctx.fillStyle = "#8aa093";
    ctx.fillText("Listening for the next question…", PAD + 14, top + 40);
    ctx.restore();
  }
  ctx.font = `400 14.5px ${SANS}`;
  ctx.fillStyle = "#1f3a30";
  drawWords(ctx, layout, PAD + 14, top + 40, phases.transcript * QUESTION_WORD_COUNT);
  return top + height;
}

function paintDetected(ctx: CanvasRenderingContext2D, phases: Phases, top: number) {
  if (phases.detect <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = phases.detect;
  const scale = 0.92 + phases.detect * 0.08;
  ctx.translate(PAD, top + 19);
  ctx.scale(scale, scale);
  ctx.translate(-PAD, -(top + 19));
  fillRound(ctx, PAD, top, PANEL_WIDTH, 38, 14, GREEN);
  ctx.fillStyle = "#5fd394";
  ctx.beginPath();
  ctx.arc(PAD + 22, top + 19, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#06261a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PAD + 17.5, top + 19);
  ctx.lineTo(PAD + 21, top + 22.5);
  ctx.lineTo(PAD + 27, top + 15.5);
  ctx.stroke();
  ctx.textBaseline = "middle";
  ctx.font = `600 13px ${SANS}`;
  ctx.fillStyle = "#eafff3";
  ctx.fillText("Question detected", PAD + 40, top + 19);
  ctx.font = `600 10.5px ${SANS}`;
  const typeWidth = ctx.measureText(QUESTION_TYPE).width + 16;
  fillRound(ctx, PAD + PANEL_WIDTH - typeWidth - 9, top + 8, typeWidth, 22, 11, "rgba(255, 255, 255, 0.16)");
  ctx.fillStyle = "#eafff3";
  ctx.fillText(QUESTION_TYPE, PAD + PANEL_WIDTH - typeWidth - 1, top + 19);
  ctx.restore();
}

function paintAnswer(ctx: CanvasRenderingContext2D, phases: Phases, top: number) {
  if (phases.detect <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = phases.detect;
  panel(ctx, top, PHONE_SIZE.height - top - 18);
  label(ctx, "SUGGESTED ANSWER", PAD + 14, top + 20);

  ctx.textBaseline = "top";
  ctx.save();
  ctx.globalAlpha *= clamp01(phases.answer * 30);
  ctx.font = `700 17px ${SANS}`;
  ctx.fillStyle = INK;
  ctx.fillText(ANSWER_TITLE, PAD + 14, top + 36);
  ctx.restore();

  const reveal = phases.answer * ANSWER_WORD_COUNT;
  let y = top + 66;
  ANSWER_PARTS.forEach((part, index) => {
    const start = ANSWER_PART_STARTS[index];
    ctx.font = `400 13px ${SANS}`;
    const layout = layoutWords(ctx, part.text, PANEL_WIDTH - 40, ANSWER_LINE, start);
    const blockHeight = 20 + layout.lineCount * ANSWER_LINE;
    const visible = clamp01((reveal - start) * 0.6);
    if (visible > 0) {
      ctx.save();
      ctx.globalAlpha *= visible;
      fillRound(ctx, PAD + 14, y, 2, blockHeight, 1, "#9ccfaf");
      ctx.font = `700 10px ${SANS}`;
      ctx.fillStyle = GREEN;
      ctx.fillText(part.label, PAD + 24, y + 2);
      ctx.restore();
      ctx.font = `400 13px ${SANS}`;
      ctx.fillStyle = "#2f4c40";
      drawWords(ctx, layout, PAD + 24, y + 18, reveal);
    }
    y += blockHeight + 10;
  });

  if (phases.source > 0.01) {
    ctx.save();
    ctx.globalAlpha *= phases.source;
    ctx.textBaseline = "middle";
    ctx.font = `500 11px ${SANS}`;
    ctx.fillStyle = LABEL;
    strokeRound(ctx, PAD + 14, y + 3, 9, 12, 2, LABEL, 1.2);
    ctx.fillText(SOURCES, PAD + 30, y + 9);
    fillRound(ctx, PHONE_SIZE.width - PAD - 84, y - 2, 70, 22, 11, "#eaf3e6");
    ctx.fillText("+2 sources", PHONE_SIZE.width - PAD - 76, y + 9);
    ctx.restore();
  }
  ctx.restore();
}

export function paintPhone(ctx: CanvasRenderingContext2D, phases: Phases, time: number) {
  const { width, height, radius } = PHONE_SIZE;
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0, 0, width, height, radius);
  ctx.clip();
  const background = ctx.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, "#f7faf6");
  background.addColorStop(1, "#eef4ec");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  paintChrome(ctx);
  const transcriptBottom = paintTranscript(ctx, phases, time, 92);
  paintDetected(ctx, phases, transcriptBottom + 10);
  paintAnswer(ctx, phases, transcriptBottom + 58);
  ctx.restore();
}
