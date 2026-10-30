import { VoiceUploadError } from "@supaterm/client-runtime/state/transcription";
import {
  TRANSCRIPTION_MAX_AUDIO_BYTES,
  TRANSCRIPTION_MAX_SECONDS,
  TranscriptionError,
} from "@supaterm/contracts";

import { loadExpoFileSystem } from "./expoFileSystem";

const SAMPLE_RATE = 16_000;
const BYTES_PER_SAMPLE = 2;
const MIN_DURATION_MS = 300;
// iOS pads the header with a filler chunk so the samples start on a 4 KiB boundary.
const HEADER_READ_BYTES = 64 * 1024;

export type VoiceRecordingCheck =
  | { readonly ok: true; readonly durationMs: number; readonly sizeBytes: number }
  | { readonly ok: false; readonly reason: "invalidAudio" | "audioTooShort" | "audioTooLong" };

const ascii = (bytes: Uint8Array, offset: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + 4));

function pcmDataBytes(header: Uint8Array, sizeBytes: number): number | null {
  if (header.byteLength < 12 || ascii(header, 0) !== "RIFF" || ascii(header, 8) !== "WAVE") {
    return null;
  }
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  let formatOk = false;
  let offset = 12;
  while (offset + 8 <= header.byteLength) {
    const id = ascii(header, offset);
    const size = view.getUint32(offset + 4, true);
    const bodyStart = offset + 8;
    if (id === "data") return formatOk ? Math.min(size, sizeBytes - bodyStart) : null;
    if (bodyStart + size > header.byteLength) return null;
    if (id === "fmt ") {
      formatOk =
        size >= 16 &&
        view.getUint16(bodyStart, true) === 1 &&
        view.getUint16(bodyStart + 2, true) === 1 &&
        view.getUint32(bodyStart + 4, true) === SAMPLE_RATE &&
        view.getUint32(bodyStart + 8, true) === SAMPLE_RATE * BYTES_PER_SAMPLE &&
        view.getUint16(bodyStart + 12, true) === BYTES_PER_SAMPLE &&
        view.getUint16(bodyStart + 14, true) === BYTES_PER_SAMPLE * 8;
    }
    offset = bodyStart + size + (size % 2);
  }
  return null;
}

/** Checks a recording against what environments transcribe before any of it is uploaded. */
export function checkVoiceRecordingWav(header: Uint8Array, sizeBytes: number): VoiceRecordingCheck {
  if (sizeBytes > TRANSCRIPTION_MAX_AUDIO_BYTES) return { ok: false, reason: "audioTooLong" };
  const dataBytes = pcmDataBytes(header, sizeBytes);
  if (dataBytes === null) return { ok: false, reason: "invalidAudio" };
  const durationMs = Math.round((dataBytes / (SAMPLE_RATE * BYTES_PER_SAMPLE)) * 1000);
  if (durationMs < MIN_DURATION_MS) return { ok: false, reason: "audioTooShort" };
  if (durationMs > TRANSCRIPTION_MAX_SECONDS * 1000) return { ok: false, reason: "audioTooLong" };
  return { ok: true, durationMs, sizeBytes };
}

export async function readVoiceRecording(
  uri: string,
): Promise<{ readonly durationMs: number; readonly sizeBytes: number }> {
  const { File, FileMode } = await loadExpoFileSystem();
  const file = new File(uri);
  const sizeBytes = file.size;
  const handle = file.open(FileMode.ReadOnly);
  let header: Uint8Array;
  try {
    header = await handle.readBytes(Math.min(sizeBytes, HEADER_READ_BYTES));
  } finally {
    handle.close();
  }
  const check = checkVoiceRecordingWav(header, sizeBytes);
  if (!check.ok) {
    throw new VoiceUploadError(
      check.reason,
      new TranscriptionError({ reason: check.reason }).message,
      false,
    );
  }
  return check;
}
