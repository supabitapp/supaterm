import type { TranscriptionError } from "@supaterm/contracts";
import type * as Effect from "effect/Effect";

const SAMPLE_RATE = 16_000;
const BYTES_PER_SAMPLE = 2;
const PCM_FORMAT = 1;

export interface WavAudio {
  /** The whole file, for backends that upload WAV. */
  readonly file: Uint8Array;
  /** Little-endian 16-bit mono samples at 16 kHz, without the header. */
  readonly pcm: Uint8Array;
  readonly durationMs: number;
}

export interface ProviderTranscription {
  readonly acceptsKeyterms: boolean;
  /** `code` is a lowercase primary language subtag such as `en` or `no`. */
  readonly supportsLanguage: (code: string) => boolean;
  readonly transcribe: (input: {
    readonly audio: WavAudio;
    readonly language: string | undefined;
    readonly keyterms: ReadonlyArray<string>;
  }) => Effect.Effect<{ readonly text: string }, TranscriptionError>;
}

const ascii = (bytes: Uint8Array, offset: number) =>
  String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);

/**
 * Accepts only canonical PCM WAV: 16 kHz, mono, 16-bit. Chunk sizes are
 * checked against the bytes actually present, never the RIFF header's size.
 */
export function parseWav(file: Uint8Array): WavAudio | null {
  if (file.byteLength < 12 || ascii(file, 0) !== "RIFF" || ascii(file, 8) !== "WAVE") return null;
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let format: { readonly ok: boolean } | undefined;
  let offset = 12;
  while (offset + 8 <= file.byteLength) {
    const id = ascii(file, offset);
    const size = view.getUint32(offset + 4, true);
    const bodyStart = offset + 8;
    if (bodyStart + size > file.byteLength) return null;
    if (id === "fmt ") {
      if (size < 16) return null;
      format = {
        ok:
          view.getUint16(bodyStart, true) === PCM_FORMAT &&
          view.getUint16(bodyStart + 2, true) === 1 &&
          view.getUint32(bodyStart + 4, true) === SAMPLE_RATE &&
          view.getUint32(bodyStart + 8, true) === SAMPLE_RATE * BYTES_PER_SAMPLE &&
          view.getUint16(bodyStart + 12, true) === BYTES_PER_SAMPLE &&
          view.getUint16(bodyStart + 14, true) === BYTES_PER_SAMPLE * 8,
      };
    }
    if (id === "data") {
      if (!format?.ok || size % BYTES_PER_SAMPLE !== 0) return null;
      return {
        file,
        pcm: file.subarray(bodyStart, bodyStart + size),
        durationMs: Math.round((size / (SAMPLE_RATE * BYTES_PER_SAMPLE)) * 1000),
      };
    }
    offset = bodyStart + size + (size % 2);
  }
  return null;
}
