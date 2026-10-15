// Streaming area resampling preserves timing across AudioWorklet's 128-sample blocks.
// A 100 ms packet contains 1 channel byte followed by 1600 PCM16 little-endian samples.
export class PcmResampler {
  constructor(inputRate, channel, outputRate = 16000, blockSamples = 1600) {
    if (!Number.isFinite(inputRate) || inputRate <= 0 || ![0, 1].includes(channel)) throw new Error("Invalid audio format");
    this.ratio = inputRate / outputRate;
    this.channel = channel;
    this.blockSamples = blockSamples;
    this.filled = 0;
    this.sum = 0;
    this.offset = 0;
    this.packet = new ArrayBuffer(1 + blockSamples * 2);
    this.view = new DataView(this.packet);
    this.view.setUint8(0, channel);
  }
  push(input, emit) {
    for (let i = 0; i < input.length; i++) {
      let remaining = 1;
      const sample = Number.isFinite(input[i]) ? input[i] : 0;
      while (remaining > 1e-9) {
        const weight = Math.min(remaining, this.ratio - this.filled);
        this.sum += sample * weight;
        this.filled += weight;
        remaining -= weight;
        if (this.filled >= this.ratio - 1e-9) {
          const value = Math.max(-1, Math.min(1, this.sum / this.ratio));
          this.view.setInt16(1 + this.offset * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
          this.offset++;
          this.filled = 0;
          this.sum = 0;
          if (this.offset === this.blockSamples) {
            emit(this.packet);
            this.packet = new ArrayBuffer(1 + this.blockSamples * 2);
            this.view = new DataView(this.packet);
            this.view.setUint8(0, this.channel);
            this.offset = 0;
          }
        }
      }
    }
  }
}
