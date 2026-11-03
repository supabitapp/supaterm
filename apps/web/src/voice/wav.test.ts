import { describe, expect, it } from "vite-plus/test";

import { Pcm16Resampler, VOICE_SAMPLE_RATE, wavFromPcm } from "./wav";

const resample = (inputRate: number, blocks: ReadonlyArray<ReadonlyArray<number>>) => {
  const resampler = new Pcm16Resampler(inputRate);
  const samples: Array<number> = [];
  for (const block of blocks)
    resampler.push(Float32Array.from(block), (sample) => samples.push(sample));
  return samples;
};

describe("wavFromPcm", () => {
  it("wraps the recorded PCM byte for byte in a 16 kHz mono 16-bit header", async () => {
    const wav = wavFromPcm([new Uint8Array([1, 2, 3, 4]), new Uint8Array([5, 6])]);
    const view = new DataView(await wav.arrayBuffer());
    const text = (offset: number, length: number) =>
      String.fromCharCode(...new Uint8Array(view.buffer, offset, length));

    expect(wav.type).toBe("audio/wav");
    expect(text(0, 4)).toBe("RIFF");
    expect(text(8, 4)).toBe("WAVE");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(VOICE_SAMPLE_RATE);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(6);
    expect([...new Uint8Array(view.buffer, 44)]).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("Pcm16Resampler", () => {
  it("averages each output sample's span and clips loud input", () => {
    expect(resample(48_000, [[0.3, 0.3, 0.3, -1, -1, -1, 2, 2, 2]])).toEqual([9830, -32768, 32767]);
  });

  it("resamples audio split across render quanta like one block", () => {
    const signal = Array.from({ length: 441 * 4 }, (_, index) => Math.sin(index / 7) * 0.5);
    const whole = resample(44_100, [signal]);
    const split = resample(44_100, [
      signal.slice(0, 128),
      signal.slice(128, 1000),
      signal.slice(1000),
    ]);
    expect(split).toEqual(whole);
    // 1,764 samples at 44.1 kHz are 40 ms: 640 samples at 16 kHz, give or take the last one.
    expect(whole.length).toBeGreaterThanOrEqual(639);
    expect(whole.length).toBeLessThanOrEqual(640);
  });
});
