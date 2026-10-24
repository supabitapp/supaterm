const SAMPLE_RATE = 24_000;

export function encodeMonoWav(channels: ReadonlyArray<Float32Array>, sampleRate: number): Blob {
  const length = channels[0]?.length ?? 0;
  const bytes = new ArrayBuffer(44 + length * 2);
  const view = new DataView(bytes);
  const writeText = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index++) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  writeText(0, "RIFF");
  view.setUint32(4, bytes.byteLength - 8, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, length * 2, true);
  for (let index = 0; index < length; index++) {
    let mixed = 0;
    for (const channel of channels) mixed += channel[index] ?? 0;
    const sample = Math.max(-1, Math.min(1, mixed / channels.length));
    view.setInt16(44 + index * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return new Blob([bytes], { type: "audio/wav" });
}

export async function convertRecordingToWav(blob: Blob): Promise<Blob> {
  const context = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  const decoded = await context.decodeAudioData(await blob.arrayBuffer());
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) =>
    decoded.getChannelData(index),
  );
  return encodeMonoWav(channels, decoded.sampleRate);
}
