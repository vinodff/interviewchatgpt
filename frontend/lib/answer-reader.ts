/**
 * Local, conservative alignment of recognized speech to a displayed answer.
 * Offsets refer to the original UTF-16 string so rendering can preserve every
 * space and punctuation mark. This estimates spoken progress, not eye position;
 * paced reading estimates progress even when no speech is available.
 */
export interface AnswerWord {
  text: string;
  normalized: string;
  start: number;
  end: number;
}

export interface SpokenProgressOptions {
  speaker?: "user" | "unknown";
  maxLookAhead?: number;
}

export interface SpokenProgress {
  /** Index of the last confidently aligned spoken word. */
  wordIndex: number;
  confidence: number;
}

export interface PacedProgressOptions {
  /** Word displayed when the caller started or resumed its active clock. */
  startIndex: number;
  /** Active reading time only; exclude paused, hidden, or disconnected time. */
  elapsedMs: number;
  wordsPerMinute: number;
}

export type ReaderMode = "auto" | "speech" | "paced";
export type ReaderSource = "waiting" | "speech" | "paced" | "complete";

export interface ReaderClockState {
  /** The displayed estimate may be corrected backwards by actual speech. */
  wordIndex: number;
  /** Actual aligned speech remains monotonic within one answer generation. */
  spokenIndex: number;
  source: ReaderSource;
  mode: ReaderMode;
  paceAnchorIndex: number;
  paceAnchorAt: number;
  holdUntil: number;
  knownUserHoldStart: number | null;
  knownUserLastAt: number | null;
  knownUserEpisodeId: string | null;
  lastSpeechId: string | null;
  lastSpeechText: string | null;
  lastTickAt: number;
  observedLength: number;
}

export interface ReaderClockOptions {
  now: number;
  mode: ReaderMode;
  wordsPerMinute: number;
  /** A fresh transcript update received after this answer became ready. */
  speech?: { id: string; role: "user" | "unknown"; text: string };
}

const SPEECH_GRACE_MS = 3500;

const WORD_PATTERN = /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’ʼ][\p{L}\p{M}\p{N}]+)*/gu;
const HESITATIONS = new Set(["um", "umm", "uh", "uhh", "erm", "hmm", "hm", "ah"]);
const COMMON_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "because", "but", "by",
  "can", "could", "did", "do", "does", "for", "from", "had", "has", "have",
  "how", "i", "i'm", "i've", "if", "in", "is", "it", "its", "me", "my",
  "of", "on", "or", "our", "so", "that", "the", "their", "them", "then",
  "there", "these", "they", "this", "those", "to", "used", "use", "uses",
  "was", "we", "were", "what", "when", "where", "which", "who", "why",
  "will", "with", "would", "you", "your",
]);

function normalizeWord(word: string): string {
  return word.normalize("NFKD").replace(/\p{M}/gu, "").replace(/[’ʼ]/gu, "'").toLowerCase();
}

function isExplicitQuestion(utterance: string): boolean {
  const text = utterance.trim();
  if (/[?？]$/u.test(text)) return true;
  const latestClause = text.split(/[.!?;\n]/u).filter((clause) => clause.trim()).at(-1)?.trim() ?? "";
  return /^(?:why|how|what|when|where|who|which)\s+(?:did|do|does|is|are|was|were|would|will|can|could|have|has|should)\b/iu.test(latestClause)
    || /^(?:why)\s+(?:use|choose|implement|add|store|cache)\b/iu.test(latestClause)
    || /^(?:can|could|would|will|did|do|does|have|has|are|is|was|were|should)\s+(?:you|we|i|it|there|the|this|that|your)\b/iu.test(latestClause)
    || /^(?:tell|explain|describe|walk)\s+(?:me|us|how|why|your|the)\b/iu.test(latestClause);
}

export function tokenizeAnswer(text: string): AnswerWord[] {
  return Array.from(text.matchAll(WORD_PATTERN), (match) => ({
    text: match[0],
    normalized: normalizeWord(match[0]),
    start: match.index,
    end: match.index + match[0].length,
  }));
}

/** One-character ASR typos are allowed only for longer, nonnumeric words. */
function wordSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  if (Math.min(left.length, right.length) < 5 || /\d/u.test(left + right)) return 0;
  if (Math.abs(left.length - right.length) > 1) return 0;
  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    if (++edits > 1) return 0;
    if (left.length >= right.length) leftIndex += 1;
    if (right.length >= left.length) rightIndex += 1;
  }
  edits += (left.length - leftIndex) + (right.length - rightIndex);
  return edits <= 1 ? 0.85 : 0;
}

interface Alignment {
  score: number;
  matches: number;
  similarity: number;
  firstSpoken: number;
  firstAnswer: number;
  distinct: Set<string>;
  content: Set<string>;
}

/**
 * Align the most recent spoken suffix. The last recognized word must match the
 * reported answer word. Small gaps tolerate omitted/repeated words; thresholds
 * reject isolated keywords, generic phrases, and distant repeated passages.
 * Callers must reset currentIndex for each new answer generation and must not
 * pass interviewer speech or transcripts received before that answer began.
 */
export function matchSpokenProgress(
  answer: readonly AnswerWord[],
  utterance: string,
  currentIndex: number,
  options: SpokenProgressOptions = {},
): SpokenProgress | null {
  if (!answer.length || isExplicitQuestion(utterance)) return null;
  const spoken = tokenizeAnswer(utterance)
    .map((word) => word.normalized)
    .filter((word) => !HESITATIONS.has(word))
    .slice(-256);
  // Final ASR updates can contain an entire answer. Advance through bounded,
  // overlapping windows first, so trimming to the final suffix cannot discard
  // the only anchor near the current cursor. Every step retains the same guards.
  let cursor = currentIndex;
  for (let offset = 0; offset + 18 < spoken.length; offset += 12) {
    const progress = matchSpokenWindow(answer, spoken.slice(offset, offset + 18), cursor, options);
    if (progress) cursor = progress.wordIndex;
  }
  return matchSpokenWindow(answer, spoken.slice(-18), cursor, options);
}

function matchSpokenWindow(
  answer: readonly AnswerWord[],
  spoken: readonly string[],
  currentIndex: number,
  options: SpokenProgressOptions,
): SpokenProgress | null {
  const knownUser = options.speaker === "user";
  const minimumMatches = knownUser ? 3 : 5;
  if (spoken.length < minimumMatches) return null;
  const current = Math.max(-1, Math.min(answer.length - 1, Number.isFinite(currentIndex) ? Math.floor(currentIndex) : -1));
  const lookAhead = Math.max(4, Math.min(64, Number.isFinite(options.maxLookAhead) ? Math.floor(options.maxLookAhead!) : 32));
  // A growing ASR utterance still contains words immediately before the cursor.
  const lower = Math.max(0, current - 18);
  const upper = Math.min(answer.length - 1, current + lookAhead);
  const width = upper - lower + 1;
  const alignments: (Alignment | undefined)[][] = Array.from({ length: spoken.length }, () => Array(width));
  const candidates: (SpokenProgress & { score: number })[] = [];

  for (let spokenIndex = 0; spokenIndex < spoken.length; spokenIndex += 1) {
    for (let localIndex = 0; localIndex < width; localIndex += 1) {
      const answerIndex = lower + localIndex;
      const normalized = answer[answerIndex].normalized;
      const similarity = wordSimilarity(spoken[spokenIndex], normalized);
      if (!similarity) continue;
      let alignment: Alignment = {
        score: similarity * 2.6,
        matches: 1,
        similarity,
        firstSpoken: spokenIndex,
        firstAnswer: answerIndex,
        distinct: new Set([normalized]),
        content: new Set(COMMON_WORDS.has(normalized) ? [] : [normalized]),
      };
      // At most two inserted ASR words or three omitted answer words per gap.
      for (let spokenStep = 1; spokenStep <= 3 && spokenStep <= spokenIndex; spokenStep += 1) {
        for (let answerStep = 1; answerStep <= 4 && answerStep <= localIndex; answerStep += 1) {
          const previous = alignments[spokenIndex - spokenStep][localIndex - answerStep];
          if (!previous) continue;
          const score = previous.score + similarity * 2.6 - (spokenStep + answerStep - 2) * 0.7;
          if (score <= alignment.score) continue;
          const distinct = new Set(previous.distinct);
          distinct.add(normalized);
          const content = new Set(previous.content);
          if (!COMMON_WORDS.has(normalized)) content.add(normalized);
          alignment = {
            score,
            matches: previous.matches + 1,
            similarity: previous.similarity + similarity,
            firstSpoken: previous.firstSpoken,
            firstAnswer: previous.firstAnswer,
            distinct,
            content,
          };
        }
      }
      alignments[spokenIndex][localIndex] = alignment;
      if (spokenIndex !== spoken.length - 1 || answerIndex < current) continue;
      if (alignment.matches < minimumMatches || alignment.distinct.size < (knownUser ? 3 : 4)) continue;
      if (alignment.content.size < (knownUser ? 2 : 3)) continue;
      const spokenCoverage = alignment.matches / (spokenIndex - alignment.firstSpoken + 1);
      const answerCoverage = alignment.matches / (answerIndex - alignment.firstAnswer + 1);
      if (spokenCoverage < (knownUser ? 0.68 : 0.8) || answerCoverage < (knownUser ? 0.6 : 0.75)) continue;
      // A short phrase cannot move the reader to a distant later occurrence.
      if (alignment.firstAnswer > Math.max(0, current) + (knownUser ? 8 : 4)) continue;
      if (answerIndex - current > Math.max(12, alignment.matches * 2 + 4)) continue;
      const confidence = Math.min(1, (spokenCoverage + answerCoverage + alignment.similarity / alignment.matches) / 3);
      candidates.push({ wordIndex: answerIndex, confidence, score: alignment.score });
    }
  }
  if (!candidates.length) return null;
  const bestScore = Math.max(...candidates.map((candidate) => candidate.score));
  // Prefer the closest occurrence when the same phrase repeats in an answer.
  const best = candidates.filter((candidate) => candidate.score >= bestScore - 0.7)
    .sort((left, right) => left.wordIndex - right.wordIndex)[0];
  return { wordIndex: best.wordIndex, confidence: best.confidence };
}

/** Clamp persisted or otherwise untrusted UI settings to the supported range. */
export function readingWordsPerMinute(value: number): number {
  return Number.isFinite(value) ? Math.min(240, Math.max(60, value)) : 130;
}

/**
 * Pure elapsed-time estimate. The UI owns pause/resume anchors; when a streamed
 * answer reaches its current last word, reset the anchor before continuing on
 * new text so time spent waiting cannot skip newly appended words.
 */
export function pacedWordIndex(answer: readonly AnswerWord[], options: PacedProgressOptions): number {
  if (!answer.length) return -1;
  const start = Math.min(answer.length - 1, Math.max(0, Number.isFinite(options.startIndex) ? Math.floor(options.startIndex) : 0));
  const elapsed = Number.isFinite(options.elapsedMs) ? Math.max(0, options.elapsedMs) : 0;
  const advance = Math.floor(elapsed * readingWordsPerMinute(options.wordsPerMinute) / 60_000);
  return Math.min(answer.length - 1, start + advance);
}

/** Start a new generation, or resume with explicit indices after a UI pause. */
export function createReaderClock(
  now: number,
  options: { wordIndex?: number; spokenIndex?: number; mode?: ReaderMode } = {},
): ReaderClockState {
  const time = Number.isFinite(now) ? now : 0;
  const mode = options.mode ?? "auto";
  const wordIndex = Number.isFinite(options.wordIndex) ? Math.max(0, Math.floor(options.wordIndex!)) : 0;
  const spokenIndex = Number.isFinite(options.spokenIndex) ? Math.max(-1, Math.floor(options.spokenIndex!)) : -1;
  const holdUntil = mode === "auto" ? time + SPEECH_GRACE_MS : time;
  return {
    wordIndex,
    spokenIndex,
    mode,
    source: mode === "paced" ? "paced" : "waiting",
    paceAnchorIndex: wordIndex,
    paceAnchorAt: holdUntil,
    holdUntil,
    knownUserHoldStart: null,
    knownUserLastAt: null,
    knownUserEpisodeId: null,
    lastSpeechId: null,
    lastSpeechText: null,
    lastTickAt: time,
    observedLength: 0,
  };
}

/**
 * Hybrid reader clock. Speech corrects a timed estimate using the independent
 * actual-speech cursor. An unmatched known user's opening words get one bounded
 * grace period; continuing ASR updates cannot keep extending that same period.
 * Unknown speech holds the pace only when the strong alignment threshold passes.
 * The caller resets the clock on new generations and pause/resume; do not pass
 * hidden or disconnected time as active elapsed time, or stale transcript events.
 */
export function advanceReaderClock(
  words: readonly AnswerWord[],
  previous: ReaderClockState,
  options: ReaderClockOptions,
): ReaderClockState {
  const now = Math.max(previous.lastTickAt, Number.isFinite(options.now) ? options.now : previous.lastTickAt);
  const state = options.mode === previous.mode
    ? { ...previous }
    : createReaderClock(now, { wordIndex: previous.wordIndex, spokenIndex: previous.spokenIndex, mode: options.mode });
  state.lastTickAt = now;
  if (!words.length) return { ...state, wordIndex: -1, spokenIndex: -1, source: "waiting", observedLength: 0 };
  state.wordIndex = Math.min(words.length - 1, Math.max(0, state.wordIndex));
  state.spokenIndex = Math.min(words.length - 1, state.spokenIndex);
  // A streamed answer may grow after the clock has reached its available end.
  if (state.observedLength > 0 && words.length > state.observedLength && previous.wordIndex === state.observedLength - 1) {
    state.paceAnchorIndex = state.wordIndex;
    state.paceAnchorAt = Math.max(now, state.holdUntil);
  }
  state.observedLength = words.length;

  if (state.mode !== "speech" && now >= state.holdUntil) {
    state.wordIndex = Math.max(state.wordIndex, pacedWordIndex(words, {
      startIndex: state.paceAnchorIndex,
      elapsedMs: now - state.paceAnchorAt,
      wordsPerMinute: options.wordsPerMinute,
    }));
    state.source = "paced";
  }

  const speech = options.speech;
  const freshSpeech = speech && (speech.id !== state.lastSpeechId || speech.text !== state.lastSpeechText);
  if (freshSpeech) {
    state.lastSpeechId = speech.id;
    state.lastSpeechText = speech.text;
    if (state.mode !== "paced") {
      const match = matchSpokenProgress(words, speech.text, state.spokenIndex, { speaker: speech.role });
      if (match && match.wordIndex >= state.spokenIndex) {
        state.spokenIndex = match.wordIndex;
        state.wordIndex = match.wordIndex;
        state.source = "speech";
        state.holdUntil = now + (state.mode === "auto" ? SPEECH_GRACE_MS : 0);
        state.paceAnchorIndex = match.wordIndex;
        state.paceAnchorAt = state.holdUntil;
      } else if (speech.role === "user" && tokenizeAnswer(speech.text).some((word) => !HESITATIONS.has(word.normalized))) {
        const newEpisode = state.knownUserLastAt === null
          || (speech.id !== state.knownUserEpisodeId && now - state.knownUserLastAt >= SPEECH_GRACE_MS);
        if (newEpisode) {
          state.knownUserHoldStart = now;
          state.knownUserEpisodeId = speech.id;
        }
        state.knownUserLastAt = now;
        const episodeEnd = (state.knownUserHoldStart ?? now) + SPEECH_GRACE_MS;
        if (state.mode === "auto" && episodeEnd > state.holdUntil) {
          state.holdUntil = episodeEnd;
          state.paceAnchorIndex = state.wordIndex;
          state.paceAnchorAt = episodeEnd;
          state.source = state.spokenIndex < 0 ? "waiting" : "speech";
        }
      }
      if (speech.role === "user" && match && match.wordIndex >= previous.spokenIndex) {
        state.knownUserLastAt = now;
        state.knownUserHoldStart = now;
        state.knownUserEpisodeId = speech.id;
      }
    }
  }
  if (state.wordIndex === words.length - 1 && (state.source === "speech" || state.source === "paced")) state.source = "complete";
  return state;
}
