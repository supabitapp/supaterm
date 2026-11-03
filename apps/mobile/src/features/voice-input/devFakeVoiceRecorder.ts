import { File, Paths } from "expo-file-system";

import type {
  NativeVoiceRecorder,
  VoiceRecordingState,
  VoiceRecordingStatusEvent,
} from "./lazyVoiceRecorder";

const SOURCE_NAME = "dev-fake-microphone.wav";
const SAMPLE_RATE = 16_000;
const BYTES_PER_SAMPLE = 2;
const WAV_HEADER_BYTES = 44;
const LEVEL_WINDOW_MS = 80;
const FRAME_MS = 100;

/**
 * Dev only: a 16 kHz WAV saved as `dev-fake-microphone.wav` in the app's documents stands in
 * for the microphone, so a simulator on a machine without one can still speak. It plays out in
 * real time, then silence, and the recording holds exactly the frames it streamed.
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

function wavFile(pcm: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(WAV_HEADER_BYTES + pcm.byteLength);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index++) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  ascii(0, "RIFF");
  view.setUint32(4, WAV_HEADER_BYTES - 8 + pcm.byteLength, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * BYTES_PER_SAMPLE, true);
  view.setUint16(32, BYTES_PER_SAMPLE, true);
  view.setUint16(34, BYTES_PER_SAMPLE * 8, true);
  ascii(36, "data");
  view.setUint32(40, pcm.byteLength, true);
  bytes.set(pcm, WAV_HEADER_BYTES);
  return bytes;
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
  const frameListeners = new Set<(pcm: Uint8Array) => void>();
  let samples: Int16Array<ArrayBuffer> = new Int16Array();
  let limitBytes = 0;
  let recordedBytes = 0;
  let uri: string | null = null;
  let startedAt: number | null = null;
  let limit: ReturnType<typeof setTimeout> | null = null;
  let pacer: ReturnType<typeof setInterval> | null = null;

  // The clip, then silence once it runs out.
  const clipBytes = (start: number, end: number) => {
    const pcm = new Uint8Array(end - start);
    pcm.set(new Uint8Array(samples.buffer).subarray(start, end));
    return pcm;
  };

  const emitDueFrames = () => {
    if (startedAt === null) return;
    const elapsedSamples = Math.floor(((Date.now() - startedAt) / 1000) * SAMPLE_RATE);
    const due = Math.min(limitBytes, elapsedSamples * BYTES_PER_SAMPLE);
    if (due <= recordedBytes) return;
    const pcm = clipBytes(recordedBytes, due);
    recordedBytes = due;
    for (const listener of frameListeners) listener(pcm);
  };

  const stopTimers = () => {
    if (limit) clearTimeout(limit);
    if (pacer) clearInterval(pacer);
    limit = null;
    pacer = null;
  };

  const finish = async () => {
    stopTimers();
    if (startedAt === null) return;
    emitDueFrames();
    startedAt = null;
    const recording = new File(Paths.cache, `dev-fake-microphone-${Date.now()}.wav`);
    await recording.write(wavFile(clipBytes(0, recordedBytes)));
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
      limitBytes = forDuration * SAMPLE_RATE * BYTES_PER_SAMPLE;
      recordedBytes = 0;
      startedAt = Date.now();
      pacer = setInterval(emitDueFrames, FRAME_MS);
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
    addFrameListener(listener) {
      frameListeners.add(listener);
      return { remove: () => frameListeners.delete(listener) };
    },
    getAvailableInputs: () => [],
    setInput: () => undefined,
    release() {
      stopTimers();
      startedAt = null;
      listeners.clear();
      frameListeners.clear();
    },
  };
}
