import { PcmResampler } from "./pcm-resampler.mjs";

class PcmProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.resampler = new PcmResampler(sampleRate, options.processorOptions.channel);
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    const mono = new Float32Array(channels[0].length);
    for (const channel of channels) for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / channels.length;
    this.resampler.push(mono, packet => this.port.postMessage(packet, [packet]));
    return true;
  }
}
registerProcessor("interviewpilot-pcm", PcmProcessor);
