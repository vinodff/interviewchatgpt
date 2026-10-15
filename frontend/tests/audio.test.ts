import { describe, expect, it } from "vitest";
import { PcmResampler } from "../public/audio/pcm-resampler.mjs";

function packets(rate: number, channel: number, duration: number, amplitude = 0.5) {
  const resampler = new PcmResampler(rate, channel);
  const output: ArrayBuffer[] = [];
  const samples = rate * duration;
  for (let at = 0; at < samples; at += 128) resampler.push(new Float32Array(Math.min(128, samples - at)).fill(amplitude), (packet: ArrayBuffer) => output.push(packet));
  return output;
}
describe("native-rate to PCM16 streaming", () => {
  for (const rate of [16000, 44100, 48000, 96000]) it(`preserves 100 ms framing at ${rate} Hz across worklet block boundaries`, () => {
    const output = packets(rate, 0, 2);
    expect(output).toHaveLength(20);
    output.forEach(packet => {
      expect(packet.byteLength).toBe(3201);
      const view = new DataView(packet); expect(view.getUint8(0)).toBe(0);
      for (let i = 0; i < 1600; i++) expect(Math.abs(view.getInt16(1 + i * 2, true) - 16384)).toBeLessThanOrEqual(1);
    });
  });
  it("tags the microphone as channel 1 and clips without wrapping PCM", () => {
    const positive = new DataView(packets(48000, 1, 0.1, 2)[0]);
    const negative = new DataView(packets(48000, 0, 0.1, -2)[0]);
    expect(positive.getUint8(0)).toBe(1); expect(positive.getInt16(1, true)).toBe(32767); expect(negative.getInt16(1, true)).toBe(-32768);
  });
  it("does not lose samples through one thousand small input pushes", () => {
    expect(packets(44100, 1, 10)).toHaveLength(100);
  });
  it("converts non-finite input to silence and rejects invalid formats", () => {
    expect(new DataView(packets(48000, 0, 0.1, NaN)[0]).getInt16(1, true)).toBe(0);
    expect(() => new PcmResampler(0, 0)).toThrow(); expect(() => new PcmResampler(48000, 2)).toThrow();
  });
});
