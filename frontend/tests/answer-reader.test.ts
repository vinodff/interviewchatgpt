import { describe, expect, it } from "vitest";
import { advanceReaderClock, createReaderClock, matchSpokenProgress, pacedWordIndex, readingWordsPerMinute, tokenizeAnswer } from "../lib/answer-reader";

describe("answer reading alignment", () => {
  it("preserves Unicode, contractions, original punctuation and UTF-16 offsets", () => {
    const text = "🧭 I’ve shipped café APIs—carefully.\n\tThey're stable.";
    const words = tokenizeAnswer(text);
    expect(words.map((word) => word.normalized)).toEqual(["i've", "shipped", "cafe", "apis", "carefully", "they're", "stable"]);
    expect(words[0].start).toBe(3);
    expect(words.every((word) => text.slice(word.start, word.end) === word.text)).toBe(true);
    let cursor = 0;
    const rendered = words.map((word) => {
      const segment = text.slice(cursor, word.start) + word.text;
      cursor = word.end;
      return segment;
    }).join("") + text.slice(cursor);
    expect(rendered).toBe(text);
  });

  it("tracks an identified user's reading through hesitation, repetition and omitted words", () => {
    const words = tokenizeAnswer("I used Redis for the cache to reduce database reads.");
    const match = matchSpokenProgress(words, "I used uh Redis Redis for the cache to reduce database reads", 0, { speaker: "user" });
    expect(match?.wordIndex).toBe(words.length - 1);
    expect(match?.confidence).toBeGreaterThan(0.85);
    const dropped = tokenizeAnswer("My backend caches frequently requested customer records to reduce database reads.");
    expect(matchSpokenProgress(dropped, "My backend caches customer records", 0, { speaker: "user" })?.wordIndex).toBe(6);
  });

  it("accepts minor ASR errors without equating short words or numbers", () => {
    const words = tokenizeAnswer("We validated customer records before storing database entries.");
    expect(matchSpokenProgress(words, "we validated customer records before storing databse entries", 0, { speaker: "user" })?.wordIndex).toBe(7);
    expect(matchSpokenProgress(tokenizeAnswer("The API stores 15 records."), "the API stores 50", 0, { speaker: "user" })).toBeNull();
    expect(matchSpokenProgress(tokenizeAnswer("We use a map to cache records."), "we use a cap", 0, { speaker: "user" })).toBeNull();
  });

  it("rejects generic phrases, unrelated questions and paraphrases without forced matches", () => {
    const words = tokenizeAnswer("I used Redis because atomic operations protect shared counters and reduce database traffic.");
    expect(matchSpokenProgress(words, "why did you use Redis for this project", 0, { speaker: "user" })).toBeNull();
    expect(matchSpokenProgress(words, "I chose an in memory store to speed up the service", 0, { speaker: "user" })).toBeNull();
    expect(matchSpokenProgress(tokenizeAnswer("I used it because it was there for the project."), "I used it because it was there", 0, { speaker: "user" })).toBeNull();
    const questionOverlap = tokenizeAnswer("I used Redis to cache database records and reduce query latency.");
    expect(matchSpokenProgress(questionOverlap, "Why did you use Redis to cache database records?", 0, { speaker: "unknown" })).toBeNull();
    expect(matchSpokenProgress(questionOverlap, "can you explain why you used Redis to cache database records", 0, { speaker: "user" })).toBeNull();
    expect(matchSpokenProgress(questionOverlap, "Tell me how you used Redis to cache database records", 0, { speaker: "unknown" })).toBeNull();
  });

  it("requires stronger evidence when a microphone mixes unidentified speakers", () => {
    const words = tokenizeAnswer("My backend uses Redis because atomic operations protect shared counters.");
    expect(matchSpokenProgress(words, "My backend uses Redis", 0, { speaker: "user" })?.wordIndex).toBe(3);
    expect(matchSpokenProgress(words, "My backend uses Redis", 0, { speaker: "unknown" })).toBeNull();
    expect(matchSpokenProgress(words, "My backend uses Redis because atomic operations protect shared counters", 0, { speaker: "unknown" })?.wordIndex).toBe(9);
  });

  it("stays at the closest repeated phrase and never moves backwards", () => {
    const words = tokenizeAnswer("Redis protects shared counters. Redis protects shared counters. Database writes stay consistent.");
    expect(matchSpokenProgress(words, "Redis protects shared counters", 0, { speaker: "user" })?.wordIndex).toBe(3);
    expect(matchSpokenProgress(words, "Redis protects shared counters", 3, { speaker: "user" })?.wordIndex).toBe(3);
    const advanced = matchSpokenProgress(words, "Database writes stay consistent", 7, { speaker: "user" });
    expect(advanced?.wordIndex).toBe(11);
    expect(matchSpokenProgress(words, "Redis protects shared counters", 11, { speaker: "user" })).toBeNull();
    const distant = tokenizeAnswer("First I describe the API and its routes before discussing validation security and error handling across services. Redis protects shared counters.");
    expect(matchSpokenProgress(distant, "Redis protects shared counters", 0, { speaker: "user" })).toBeNull();
  });

  it("supports appended answer text and growing interim recognition without replay regressions", () => {
    const first = tokenizeAnswer("My backend uses Redis");
    const position = matchSpokenProgress(first, "My backend uses Redis", -1, { speaker: "user" })!.wordIndex;
    const appended = tokenizeAnswer("My backend uses Redis because atomic operations protect shared counters.");
    expect(appended.slice(0, first.length)).toEqual(first);
    expect(matchSpokenProgress(appended, "My backend uses Redis because atomic operations protect", position, { speaker: "user" })?.wordIndex).toBe(7);
    expect(matchSpokenProgress(appended, "My backend uses Redis", 7, { speaker: "user" })).toBeNull();
    expect(matchSpokenProgress([], "I am reading an answer", -1, { speaker: "user" })).toBeNull();
  });

  it("aligns normal answer sentences beginning with What or How without treating them as questions", () => {
    const text = "What matters most is keeping database transactions short and validating customer records before updating shared counters.";
    const words = tokenizeAnswer(text);
    expect(matchSpokenProgress(words, text, 0, { speaker: "unknown" })?.wordIndex).toBe(words.length - 1);
    const how = tokenizeAnswer("How I implemented reliable retries involved tracking idempotency identifiers before processing customer events.");
    expect(matchSpokenProgress(how, how.map((word) => word.text).join(" "), 0, { speaker: "unknown" })?.wordIndex).toBe(how.length - 1);
    expect(matchSpokenProgress(words, "What did you do to validate customer records?", 0, { speaker: "unknown" })).toBeNull();
  });

  it("catches up a long finalized reading through sequential anchors instead of dropping its prefix", () => {
    const text = "My backend receives incoming customer events through authenticated endpoints validates each payload assigns an idempotency identifier stores the event in Redis and lets independent workers commit batched writes into PostgreSQL before acknowledging successfully persisted records.";
    const words = tokenizeAnswer(text);
    const matched = matchSpokenProgress(words, text, 0, { speaker: "user" });
    expect(matched?.wordIndex).toBe(words.length - 1);
    expect(matched?.confidence).toBe(1);
    expect(matchSpokenProgress(words, "Independent workers commit batched writes into PostgreSQL before acknowledging successfully persisted records", 0, { speaker: "user" })).toBeNull();
  });
});

describe("paced reading estimates", () => {
  const words = tokenizeAnswer("One two three four five six seven eight nine ten.");

  it("advances by active elapsed time and resumes from an explicit pause anchor", () => {
    expect(pacedWordIndex(words, { startIndex: 0, elapsedMs: 1499, wordsPerMinute: 120 })).toBe(2);
    const pausedAt = pacedWordIndex(words, { startIndex: 0, elapsedMs: 1500, wordsPerMinute: 120 });
    expect(pausedAt).toBe(3);
    // The caller excludes the hidden/disconnected pause and resumes its clock.
    expect(pacedWordIndex(words, { startIndex: pausedAt, elapsedMs: 0, wordsPerMinute: 120 })).toBe(3);
    expect(pacedWordIndex(words, { startIndex: pausedAt, elapsedMs: 500, wordsPerMinute: 120 })).toBe(4);
    expect(pacedWordIndex(words, { startIndex: 0, elapsedMs: 0, wordsPerMinute: 120 })).toBe(0);
  });

  it("bounds the speed, elapsed time and cursor instead of overflowing the answer", () => {
    expect(readingWordsPerMinute(Number.NaN)).toBe(130);
    expect(readingWordsPerMinute(12)).toBe(60);
    expect(readingWordsPerMinute(500)).toBe(240);
    expect(pacedWordIndex(words, { startIndex: 0, elapsedMs: 1000, wordsPerMinute: 500 })).toBe(4);
    expect(pacedWordIndex(words, { startIndex: 2, elapsedMs: -50, wordsPerMinute: 120 })).toBe(2);
    expect(pacedWordIndex(words, { startIndex: 0, elapsedMs: 60_000, wordsPerMinute: 120 })).toBe(9);
    expect(pacedWordIndex(words, { startIndex: 100, elapsedMs: 0, wordsPerMinute: 120 })).toBe(9);
    expect(pacedWordIndex([], { startIndex: 0, elapsedMs: 1000, wordsPerMinute: 120 })).toBe(-1);
  });
});

describe("hybrid speech and pace clock", () => {
  const words = tokenizeAnswer("My backend uses Redis because atomic operations protect shared counters while reducing database reads across all services.");
  const tick = (state: ReturnType<typeof createReaderClock>, now: number, speech?: { id: string; role: "user" | "unknown"; text: string }) =>
    advanceReaderClock(words, state, { now, mode: "auto", wordsPerMinute: 120, speech });

  it("waits for speech initially, then estimates pace without changing the actual speech cursor", () => {
    let state = createReaderClock(1000);
    state = tick(state, 4499);
    expect(state.wordIndex).toBe(0);
    expect(state.source).toBe("waiting");
    state = tick(state, 5500);
    expect(state.wordIndex).toBe(2);
    expect(state.spokenIndex).toBe(-1);
    expect(state.source).toBe("paced");
  });

  it("corrects an overtaken timed estimate back to actual speech and keeps subsequent silence monotonic", () => {
    let state = tick(createReaderClock(0), 8500);
    expect(state.wordIndex).toBe(10);
    state = tick(state, 8600, { id: "one", role: "user", text: "My backend uses Redis" });
    expect(state.wordIndex).toBe(3);
    expect(state.spokenIndex).toBe(3);
    expect(state.source).toBe("speech");
    state = tick(state, 12_100);
    expect(state.wordIndex).toBe(3);
    state = tick(state, 12_600);
    expect(state.wordIndex).toBe(4);
    state = tick(state, 13_100);
    expect(state.wordIndex).toBe(5);
    expect(state.spokenIndex).toBe(3);
    // An identical ASR replay cannot pull the display back or renew the grace.
    state = tick(state, 13_200, { id: "one", role: "user", text: "My backend uses Redis" });
    expect(state.wordIndex).toBe(5);
    expect(state.holdUntil).toBe(12_100);
  });

  it("bounds unmatched user opening-word holds even under continuous growing recognition", () => {
    let state = tick(createReaderClock(0), 4000);
    expect(state.wordIndex).toBe(1);
    state = tick(state, 4100, { id: "one", role: "user", text: "well" });
    expect(state.holdUntil).toBe(7600);
    state = tick(state, 5000, { id: "one", role: "user", text: "well I" });
    state = tick(state, 6500, { id: "one", role: "user", text: "well I think" });
    state = tick(state, 7500, { id: "one", role: "user", text: "well I think perhaps" });
    expect(state.holdUntil).toBe(7600);
    state = tick(state, 8600, { id: "one", role: "user", text: "well I think perhaps something different" });
    expect(state.wordIndex).toBe(3);
    expect(state.source).toBe("paced");
    expect(state.holdUntil).toBe(7600);
    state = tick(state, 13_000, { id: "one", role: "user", text: "well I think perhaps something entirely different now" });
    expect(state.holdUntil).toBe(7600);
    expect(state.source).toBe("paced");
  });

  it("uses a fresh repeated reading to correct pace at the same actual speech position", () => {
    let state = tick(createReaderClock(0), 100, { id: "one", role: "user", text: "My backend uses Redis" });
    state = tick(state, 6100);
    expect(state.wordIndex).toBe(8);
    expect(state.spokenIndex).toBe(3);
    state = tick(state, 6200, { id: "two", role: "user", text: "My backend uses Redis" });
    expect(state.wordIndex).toBe(3);
    expect(state.spokenIndex).toBe(3);
    expect(state.holdUntil).toBe(9700);
  });

  it("does not let unknown chatter or questions block pace, but follows a strong mixed-speaker match", () => {
    let state = tick(createReaderClock(0), 4000, { id: "one", role: "unknown", text: "My backend uses Redis" });
    expect(state.wordIndex).toBe(1);
    expect(state.holdUntil).toBe(3500);
    state = tick(state, 4500, { id: "two", role: "unknown", text: "Why does your backend use Redis because atomic operations protect shared counters?" });
    expect(state.wordIndex).toBe(2);
    expect(state.holdUntil).toBe(3500);
    state = tick(state, 4600, { id: "three", role: "unknown", text: "My backend uses Redis because atomic operations protect shared counters" });
    expect(state.wordIndex).toBe(9);
    expect(state.spokenIndex).toBe(9);
    expect(state.holdUntil).toBe(8100);
  });

  it("keeps speech mode still without matches and lets paced mode ignore speech", () => {
    const speech = advanceReaderClock(words, createReaderClock(0, { mode: "speech" }), { now: 20_000, mode: "speech", wordsPerMinute: 120 });
    expect(speech.wordIndex).toBe(0);
    expect(speech.source).toBe("waiting");
    const paced = advanceReaderClock(words, createReaderClock(0, { mode: "paced" }), {
      now: 4000, mode: "paced", wordsPerMinute: 120, speech: { id: "one", role: "user", text: "My backend uses Redis" },
    });
    expect(paced.wordIndex).toBe(8);
    expect(paced.spokenIndex).toBe(-1);
    expect(paced.source).toBe("paced");
  });

  it("excludes paused time with a fresh anchor and never skips appended text after waiting at its end", () => {
    const first = tokenizeAnswer("My backend uses Redis");
    let state = advanceReaderClock(first, createReaderClock(0, { mode: "paced" }), { now: 1500, mode: "paced", wordsPerMinute: 120 });
    expect(state.source).toBe("complete");
    state = advanceReaderClock(words, state, { now: 20_000, mode: "paced", wordsPerMinute: 120 });
    expect(state.wordIndex).toBe(3);
    state = advanceReaderClock(words, state, { now: 20_500, mode: "paced", wordsPerMinute: 120 });
    expect(state.wordIndex).toBe(4);
    state = createReaderClock(50_000, { wordIndex: state.wordIndex, spokenIndex: state.spokenIndex, mode: "auto" });
    state = tick(state, 53_000);
    expect(state.wordIndex).toBe(4);
    state = tick(state, 54_000);
    expect(state.wordIndex).toBe(5);
  });
});
