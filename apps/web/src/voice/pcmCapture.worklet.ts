import { PCM_CAPTURE_PROCESSOR, Pcm16Resampler } from "./wav";

// The AudioWorklet global scope, which the DOM library doesn't describe.
declare const sampleRate: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const FRAME_SAMPLES = 1_600;

/** Posts 100 ms frames of 16 kHz mono PCM after "start", and the remainder plus "flushed" on "flush". */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  private readonly resampler = new Pcm16Resampler(sampleRate);
  private frame = new Int16Array(FRAME_SAMPLES);
  private filled = 0;
  private capturing = false;
  private readonly append = (sample: number) => {
    this.frame[this.filled++] = sample;
    if (this.filled === FRAME_SAMPLES) this.post();
  };

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent) => {
      if (event.data === "start") this.capturing = true;
      if (event.data === "flush") {
        this.post();
        this.capturing = false;
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- A MessagePort has no target origin.
        this.port.postMessage("flushed");
      }
    };
  }

  process(inputs: ReadonlyArray<ReadonlyArray<Float32Array>>): boolean {
    const channels = inputs[0];
    if (!this.capturing || channels === undefined || channels.length === 0) return true;
    const first = channels[0]!;
    if (channels.length === 1) {
      this.resampler.push(first, this.append);
      return true;
    }
    const mixed = new Float32Array(first.length);
    for (const channel of channels) {
      for (let index = 0; index < mixed.length; index++) mixed[index]! += channel[index] ?? 0;
    }
    for (let index = 0; index < mixed.length; index++) mixed[index]! /= channels.length;
    this.resampler.push(mixed, this.append);
    return true;
  }

  private post(): void {
    if (this.filled === 0) return;
    const frame = this.frame.slice(0, this.filled);
    this.port.postMessage(frame, [frame.buffer]);
    this.filled = 0;
  }
}

registerProcessor(PCM_CAPTURE_PROCESSOR, PcmCaptureProcessor);
