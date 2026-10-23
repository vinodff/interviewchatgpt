import { describe, expect, it } from "vitest";
import { enhancedWav, joinOverlappingSpeech, packetSamples, QuietAudioSegments, signalLevel } from "../lib/quiet-audio";
import { validMicrophoneWav } from "../lib/server-transcription";

const tone = (amplitude: number) => Int16Array.from({ length: 1600 }, (_, i) => Math.round(amplitude * Math.sin(i * Math.PI / 20)));
describe("quiet audio processing", () => {
  it("boosts quiet speech up to 16x with a valid bounded WAV and no clipping", () => {
    const samples = tone(30); const result = enhancedWav(samples);
    expect(result.gain).toBe(16); expect(validMicrophoneWav(result.audio)).toBe(result.audio);
    const bytes = Buffer.from(result.audio, "base64"); expect(bytes.readUInt32LE(24)).toBe(16000);
    expect(bytes.readInt16LE(44 + 10 * 2)).toBe(samples[10] * 16);
    const loud = enhancedWav(tone(32767)); const pcm = Buffer.from(loud.audio, "base64");
    expect(Math.abs(pcm.readInt16LE(64))).toBeLessThanOrEqual(31130);
  });
  it("does not amplify digital silence or invent nonzero samples", () => {
    const result = enhancedWav(new Int16Array(1600)); expect(result.gain).toBe(1);
    expect(Buffer.from(result.audio, "base64").subarray(44).some(value => value !== 0)).toBe(false);
  });
  it("holds a slow speaker's short pauses and retains their quiet tail", () => {
    const segments = new QuietAudioSegments();
    for (let i = 0; i < 8; i++) expect(segments.push(tone(20))).toBeNull();
    for (let i = 0; i < 5; i++) expect(segments.push(tone(0))).toBeNull();
    for (let i = 0; i < 5; i++) expect(segments.push(tone(20))).toBeNull();
    for (let i = 0; i < 5; i++) expect(segments.push(tone(0))).toBeNull();
    const result = segments.push(tone(0)); expect(result?.final).toBe(true);
    expect(result?.samples.length).toBe(24 * 1600);
    expect(signalLevel(result!.samples.subarray(13 * 1600, 18 * 1600)).rms).toBeGreaterThan(0.00012);
  });
  it("bounds continuous audio and preserves a 500ms overlapping boundary", () => {
    const segments = new QuietAudioSegments(); let first = null;
    for (let i = 0; i < 40; i++) first = segments.push(tone(100));
    expect(first).toMatchObject({ final: false, overlap: false, turn: 1 });
    let next = null; for (let i = 0; i < 35; i++) next = segments.push(tone(100));
    expect(next).toMatchObject({ final: false, overlap: true, turn: 1 });
    expect(next?.samples.length).toBeLessThanOrEqual(64000);
    segments.reset(); expect(segments.push(tone(0))).toBeNull();
  });
  it("only removes a matching overlap boundary within a turn", () => {
    expect(joinOverlappingSpeech("what is a Python", "a Python dictionary")).toBe("what is a Python dictionary");
    expect(joinOverlappingSpeech("What is a Python", "Python dictionary?")).toBe("What is a Python dictionary?");
    expect(joinOverlappingSpeech("It is very", "very very quiet")).toBe("It is very very quiet");
    expect(joinOverlappingSpeech("I used Redis", "What is Python?")).toBe("I used Redis What is Python?");
  });
  it("rejects malformed, oversized and mismatched WAV headers", () => {
    expect(validMicrophoneWav("not base64")).toBeNull();
    const audio = enhancedWav(tone(100)).audio; const bytes = Buffer.from(audio, "base64"); bytes.writeUInt32LE(48000, 24);
    expect(validMicrophoneWav(bytes.toString("base64"))).toBeNull();
    expect(validMicrophoneWav(enhancedWav(new Int16Array(96001)).audio)).toBeNull();
  });
  it("decodes the worklet's unaligned PCM packet safely", () => {
    const packet = new ArrayBuffer(3201); new DataView(packet).setInt16(1, -100, true);
    expect(packetSamples(packet)[0]).toBe(-100); expect(() => packetSamples(new ArrayBuffer(2))).toThrow();
  });
});
