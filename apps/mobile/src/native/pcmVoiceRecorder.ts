import { requireOptionalNativeModule, type NativeModule } from "expo";

import type {
  NativeVoiceRecorder,
  VoiceRecordingInput,
  VoiceRecordingState,
  VoiceRecordingStatusEvent,
} from "../features/voice-input/lazyVoiceRecorder";

type PcmFrames = { readonly url: string; readonly pcm: string };

type PcmRecorderEvents = {
  onStatus: (status: VoiceRecordingStatusEvent) => void;
  onFrames: (frames: PcmFrames) => void;
};

interface PcmRecorderModule extends NativeModule<PcmRecorderEvents> {
  addListener(event: "onStatus", listener: PcmRecorderEvents["onStatus"]): { remove(): void };
  addListener(event: "onFrames", listener: PcmRecorderEvents["onFrames"]): { remove(): void };
  prepare(): Promise<{ readonly uri: string }>;
  record(maxDurationMs: number): void;
  stop(): Promise<{ readonly uri: string; readonly durationMs: number } | null>;
  getStatus(): VoiceRecordingState | null;
  /** iOS only: the session's inputs, so the preferred microphone can be chosen. */
  getAvailableInputs?(): ReadonlyArray<VoiceRecordingInput>;
  setInput?(uid: string): void;
  release(): void;
}

const IDLE: VoiceRecordingState = { isRecording: false, durationMillis: 0 };

const pcmRecorder = requireOptionalNativeModule<PcmRecorderModule>("SupatermPcmRecorder");

function decodeBase64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

function createRecorder(
  native: PcmRecorderModule,
): NativeVoiceRecorder<VoiceRecordingStatusEvent, VoiceRecordingState> {
  let uri: string | null = null;
  return {
    get uri() {
      return uri;
    },
    async prepareToRecordAsync() {
      uri = (await native.prepare()).uri;
    },
    record({ forDuration }) {
      native.record(forDuration * 1_000);
    },
    async stop() {
      await native.stop();
    },
    getStatus: () => native.getStatus() ?? IDLE,
    addListener: (_eventName, listener) =>
      native.addListener("onStatus", (status) => {
        if (status.url === uri) listener(status);
      }),
    // Native only emits frames while this listens, so an environment that can't stream pays nothing.
    addFrameListener: (listener) =>
      native.addListener("onFrames", (frames) => {
        if (frames.url === uri) listener(decodeBase64(frames.pcm));
      }),
    getAvailableInputs: () => native.getAvailableInputs?.() ?? [],
    setInput: (uid) => native.setInput?.(uid),
    release: () => native.release(),
  };
}

/** Records 16 kHz mono PCM WAV on a native thread and reports the same PCM as it is written. */
export const createPcmVoiceRecorder =
  pcmRecorder === null ? null : () => createRecorder(pcmRecorder);
