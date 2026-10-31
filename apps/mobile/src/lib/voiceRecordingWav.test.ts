import { describe, expect, it } from "vite-plus/test";

import { checkVoiceRecordingWav } from "./voiceRecordingWav";

function wavHeader(input: {
  readonly sampleRate?: number;
  readonly channels?: number;
  readonly dataBytes: number;
  readonly fillerBytes?: number;
}) {
  const sampleRate = input.sampleRate ?? 16_000;
  const channels = input.channels ?? 1;
  const filler = input.fillerBytes ?? 0;
  const bytes = new Uint8Array(12 + 24 + (filler > 0 ? 8 + filler : 0) + 8);
  const view = new DataView(bytes.buffer);
  const tag = (offset: number, value: string) =>
    [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  tag(0, "RIFF");
  view.setUint32(4, bytes.length - 8 + input.dataBytes, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  let offset = 36;
  if (filler > 0) {
    tag(offset, "FLLR");
    view.setUint32(offset + 4, filler, true);
    offset += 8 + filler;
  }
  tag(offset, "data");
  view.setUint32(offset + 4, input.dataBytes, true);
  return { header: bytes, sizeBytes: bytes.length + input.dataBytes };
}

const ONE_SECOND = 32_000;

describe("checkVoiceRecordingWav", () => {
  it("measures 16 kHz mono speech, past the filler chunk iOS writes", () => {
    const { header, sizeBytes } = wavHeader({ dataBytes: 2 * ONE_SECOND, fillerBytes: 4044 });
    expect(checkVoiceRecordingWav(header, sizeBytes)).toEqual({
      ok: true,
      durationMs: 2000,
      sizeBytes,
    });
  });

  it("refuses recordings environments would refuse", () => {
    const short = wavHeader({ dataBytes: ONE_SECOND / 4 });
    expect(checkVoiceRecordingWav(short.header, short.sizeBytes)).toEqual({
      ok: false,
      reason: "audioTooShort",
    });
    const long = wavHeader({ dataBytes: 301 * ONE_SECOND });
    expect(checkVoiceRecordingWav(long.header, long.sizeBytes)).toMatchObject({
      reason: "audioTooLong",
    });
    const stereo = wavHeader({ channels: 2, dataBytes: ONE_SECOND });
    expect(checkVoiceRecordingWav(stereo.header, stereo.sizeBytes)).toMatchObject({
      reason: "invalidAudio",
    });
    const aac = new TextEncoder().encode("\0\0\0 ftypM4A ");
    expect(checkVoiceRecordingWav(aac, 40_000)).toMatchObject({ reason: "invalidAudio" });
  });

  it("trusts the file size over a data size an interrupted write never updated", () => {
    const { header } = wavHeader({ dataBytes: 0xffff_ffff });
    expect(checkVoiceRecordingWav(header, header.length + ONE_SECOND)).toMatchObject({
      ok: true,
      durationMs: 1000,
    });
  });
});
