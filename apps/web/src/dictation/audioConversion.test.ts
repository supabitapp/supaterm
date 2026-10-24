import { describe, expect, it } from "vite-plus/test";

import { encodeMonoWav } from "./audioConversion";

describe("recording WAV conversion", () => {
  it("writes mono PCM16 with the source rate and mixes stereo without clipping", async () => {
    const blob = encodeMonoWav(
      [new Float32Array([-1, 0, 1, 0.5]), new Float32Array([-1, 1, 1, -0.5])],
      24_000,
    );
    const bytes = await blob.arrayBuffer();
    const header = new DataView(bytes);
    const text = new TextDecoder();
    expect(blob.type).toBe("audio/wav");
    expect(text.decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(text.decode(bytes.slice(8, 12))).toBe("WAVE");
    expect(header.getUint32(4, true)).toBe(bytes.byteLength - 8);
    expect(header.getUint16(20, true)).toBe(1);
    expect(header.getUint16(22, true)).toBe(1);
    expect(header.getUint32(24, true)).toBe(24_000);
    expect(header.getUint32(28, true)).toBe(48_000);
    expect(header.getUint16(34, true)).toBe(16);
    expect(header.getUint32(40, true)).toBe(8);
    expect(Array.from({ length: 4 }, (_, index) => header.getInt16(44 + index * 2, true))).toEqual([
      -32768, 16384, 32767, 0,
    ]);
  });
});
