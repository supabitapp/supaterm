import { describe, expect, it } from "vite-plus/test";

import { encodeMonoWav, VOICE_SAMPLE_RATE } from "./wav";

describe("encodeMonoWav", () => {
  it("writes a 16-bit mono PCM WAV that averages channels and clips loud samples", async () => {
    const left = new Float32Array([0, 1, -1, 0.5]);
    const right = new Float32Array([0, 1, -1, 2]);
    const wav = encodeMonoWav([left, right], VOICE_SAMPLE_RATE);
    const view = new DataView(await wav.arrayBuffer());
    const text = (offset: number, length: number) =>
      String.fromCharCode(...new Uint8Array(view.buffer, offset, length));

    expect(wav.type).toBe("audio/wav");
    expect(wav.size).toBe(44 + 4 * 2);
    expect(text(0, 4)).toBe("RIFF");
    expect(text(8, 4)).toBe("WAVE");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(8);
    expect([0, 1, 2, 3].map((index) => view.getInt16(44 + index * 2, true))).toEqual([
      0, 32767, -32768, 32767,
    ]);
  });
});
