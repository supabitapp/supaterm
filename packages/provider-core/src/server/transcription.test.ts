import { describe, expect, it } from "vite-plus/test";

import { parseWav } from "./transcription.ts";

interface Chunk {
  readonly id: string;
  readonly body: Uint8Array;
  readonly declaredSize?: number;
}

const fmt = (overrides: Partial<Record<"format" | "channels" | "rate" | "bits", number>> = {}) => {
  const body = new Uint8Array(16);
  const view = new DataView(body.buffer);
  const channels = overrides.channels ?? 1;
  const rate = overrides.rate ?? 16_000;
  const bits = overrides.bits ?? 16;
  view.setUint16(0, overrides.format ?? 1, true);
  view.setUint16(2, channels, true);
  view.setUint32(4, rate, true);
  view.setUint32(8, rate * channels * (bits / 8), true);
  view.setUint16(12, channels * (bits / 8), true);
  view.setUint16(14, bits, true);
  return { id: "fmt ", body } satisfies Chunk;
};

const data = (bytes: number) =>
  ({ id: "data", body: new Uint8Array(bytes).fill(7) }) satisfies Chunk;

const riff = (chunks: ReadonlyArray<Chunk>, riffSize?: number) => {
  const parts = chunks.flatMap((chunk) => {
    const header = new Uint8Array(8);
    header.set([...chunk.id].map((char) => char.charCodeAt(0)));
    new DataView(header.buffer).setUint32(4, chunk.declaredSize ?? chunk.body.byteLength, true);
    const padding = chunk.body.byteLength % 2 === 1 ? [new Uint8Array(1)] : [];
    return [header, chunk.body, ...padding];
  });
  const length = 12 + parts.reduce((sum, part) => sum + part.byteLength, 0);
  const file = new Uint8Array(length);
  file.set([..."RIFF"].map((char) => char.charCodeAt(0)));
  new DataView(file.buffer).setUint32(4, riffSize ?? length - 8, true);
  file.set(
    [..."WAVE"].map((char) => char.charCodeAt(0)),
    8,
  );
  let offset = 12;
  for (const part of parts) {
    file.set(part, offset);
    offset += part.byteLength;
  }
  return file;
};

describe("parseWav", () => {
  it("returns the PCM and duration of 16 kHz mono 16-bit audio", () => {
    const audio = parseWav(riff([fmt(), data(32_000)]));
    expect(audio?.durationMs).toBe(1_000);
    expect(audio?.pcm.byteLength).toBe(32_000);
    expect(audio?.pcm.every((byte) => byte === 7)).toBe(true);
  });

  it("walks past other chunks, including odd-sized ones with padding", () => {
    const list = { id: "LIST", body: new Uint8Array(5) } satisfies Chunk;
    const audio = parseWav(riff([fmt(), list, data(16_000)]));
    expect(audio?.durationMs).toBe(500);
    expect(audio?.pcm.every((byte) => byte === 7)).toBe(true);
  });

  it("ignores a RIFF size that disagrees with the bytes present", () => {
    expect(parseWav(riff([fmt(), data(3_200)], 0xffff_ffff))?.durationMs).toBe(100);
  });

  it.each([
    ["8 kHz", fmt({ rate: 8_000 })],
    ["stereo", fmt({ channels: 2 })],
    ["8-bit", fmt({ bits: 8 })],
    ["float", fmt({ format: 3 })],
  ])("rejects %s audio", (_label, format) => {
    expect(parseWav(riff([format, data(3_200)]))).toBeNull();
  });

  it("rejects a data chunk that claims more bytes than the file has", () => {
    expect(parseWav(riff([fmt(), { ...data(3_200), declaredSize: 3_202 }]))).toBeNull();
  });

  it("rejects audio with an odd number of sample bytes", () => {
    expect(parseWav(riff([fmt(), data(3_201)]))).toBeNull();
  });

  it("rejects data that comes before its format", () => {
    expect(parseWav(riff([data(3_200), fmt()]))).toBeNull();
  });

  it("rejects files that aren't RIFF WAVE", () => {
    expect(parseWav(new TextEncoder().encode("ID3 not a wave file"))).toBeNull();
    expect(parseWav(riff([fmt()]))).toBeNull();
  });
});
