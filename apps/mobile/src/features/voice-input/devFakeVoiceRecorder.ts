import { File, Paths } from "expo-file-system";

import type {
  NativeVoiceRecorder,
  VoiceRecordingState,
  VoiceRecordingStatusEvent,
} from "./lazyVoiceRecorder";

const SOURCE_NAME = "dev-fake-microphone.wav";
const SAMPLE_RATE = 16_000;
const LEVEL_WINDOW_MS = 80;

/**
 * Dev only: a 16 kHz WAV saved as `dev-fake-microphone.wav` in the app's documents stands in
 * for the microphone, so a simulator on a machine without one can still speak.
 */
export function devFakeMicrophoneSource(): File | null {
  if (!__DEV__) return null;
  const source = new File(Paths.document, SOURCE_NAME);
  return source.exists ? source : null;
}

function pcmSamples(bytes: ArrayBuffer): Int16Array<ArrayBuffer> {
  const view = new DataView(bytes);
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const id = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    );
    const size = view.getUint32(offset + 4, true);
    if (id === "data") {
      const length = Math.min(size, view.byteLength - offset - 8) >> 1;
      return new Int16Array(bytes.slice(offset + 8, offset + 8 + length * 2));
    }
    offset += 8 + size + (size & 1);
  }
  return new Int16Array();
}

function decibelsAt(samples: Int16Array<ArrayBuffer>, elapsedMs: number): number {
  const start = Math.floor((elapsedMs / 1000) * SAMPLE_RATE);
  const end = Math.min(samples.length, start + (LEVEL_WINDOW_MS / 1000) * SAMPLE_RATE);
  if (start >= end) return -160;
  let sum = 0;
  for (let index = start; index < end; index++) {
    const value = samples[index]! / 32_768;
    sum += value * value;
  }
  return 20 * Math.log10(Math.max(Math.sqrt(sum / (end - start)), 1e-8));
}

export function createDevFakeVoiceRecorder(
  source: File,
): NativeVoiceRecorder<VoiceRecordingStatusEvent, VoiceRecordingState> {
  const listeners = new Set<(status: VoiceRecordingStatusEvent) => void>();
  let samples: Int16Array<ArrayBuffer> = new Int16Array();
  let uri: string | null = null;
  let startedAt: number | null = null;
  let limit: ReturnType<typeof setTimeout> | null = null;

  const finish = async () => {
    if (limit) clearTimeout(limit);
    limit = null;
    if (startedAt === null) return;
    startedAt = null;
    const recording = new File(Paths.cache, `dev-fake-microphone-${Date.now()}.wav`);
    await source.copy(recording);
    uri = recording.uri;
  };

  return {
    get uri() {
      return uri;
    },
    async prepareToRecordAsync() {
      uri = null;
      samples = pcmSamples(await source.arrayBuffer());
    },
    record({ forDuration }) {
      startedAt = Date.now();
      limit = setTimeout(() => {
        void finish().then(() => {
          for (const listener of listeners) {
            listener({ isFinished: true, hasError: false, error: null, url: uri });
          }
        });
      }, forDuration * 1000);
    },
    stop: finish,
    getStatus() {
      const elapsed = startedAt === null ? 0 : Date.now() - startedAt;
      return {
        isRecording: startedAt !== null,
        durationMillis: elapsed,
        metering: decibelsAt(samples, elapsed),
      };
    },
    addListener(_eventName, listener) {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
    getAvailableInputs: () => [],
    setInput: () => undefined,
    release() {
      if (limit) clearTimeout(limit);
      limit = null;
      startedAt = null;
      listeners.clear();
    },
  };
}
