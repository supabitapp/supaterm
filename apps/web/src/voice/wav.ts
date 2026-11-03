/** What the environment transcribes: 16 kHz mono 16-bit PCM WAV. */
export const VOICE_SAMPLE_RATE = 16_000;
export const PCM_CAPTURE_PROCESSOR = "supaterm-pcm-capture";

/**
 * Downsamples a mono float signal to 16 kHz 16-bit samples by averaging each output
 * sample's input span, which also filters what would otherwise alias. It keeps its
 * position across calls, so audio arriving in render quanta resamples as one signal.
 */
export class Pcm16Resampler {
  private readonly ratio: number;
  private phase = 0;
  private sum = 0;
  private count = 0;

  constructor(inputRate: number) {
    this.ratio = inputRate / VOICE_SAMPLE_RATE;
  }

  push(input: Float32Array, emit: (sample: number) => void): void {
    for (const value of input) {
      this.sum += value;
      this.count += 1;
      this.phase += 1;
      while (this.phase >= this.ratio) {
        const mean = Math.max(-1, Math.min(1, this.sum / this.count));
        emit(Math.round(mean * (mean < 0 ? 32768 : 32767)));
        this.phase -= this.ratio;
      }
      if (this.phase < 1) {
        this.sum = 0;
        this.count = 0;
      }
    }
  }
}

/** A WAV around little-endian 16 kHz mono 16-bit PCM, kept byte for byte. */
export function wavFromPcm(chunks: ReadonlyArray<Uint8Array>): Blob {
  const dataBytes = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeText = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index++) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, VOICE_SAMPLE_RATE, true);
  view.setUint32(28, VOICE_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, dataBytes, true);
  return new Blob([header, ...chunks.map((chunk) => chunk.slice())], { type: "audio/wav" });
}
