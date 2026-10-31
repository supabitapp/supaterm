import { requireOptionalNativeModule, type NativeModule } from "expo";

import type {
  NativeVoiceRecorder,
  VoiceRecordingState,
  VoiceRecordingStatusEvent,
} from "../features/voice-input/lazyVoiceRecorder";

type PcmRecorderEvents = {
  onStatus: (status: VoiceRecordingStatusEvent) => void;
};

interface PcmRecorderModule extends NativeModule<PcmRecorderEvents> {
  addListener(
    event: "onStatus",
    listener: (status: VoiceRecordingStatusEvent) => void,
  ): { remove(): void };
  prepare(): Promise<{ readonly uri: string }>;
  record(maxDurationMs: number): void;
  stop(): Promise<{ readonly uri: string; readonly durationMs: number } | null>;
  getStatus(): VoiceRecordingState | null;
  release(): void;
}

const IDLE: VoiceRecordingState = { isRecording: false, durationMillis: 0 };

const pcmRecorder = requireOptionalNativeModule<PcmRecorderModule>("SupatermPcmRecorder");

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
    getAvailableInputs: () => [],
    setInput: () => undefined,
    release: () => native.release(),
  };
}

/** Records 16 kHz mono PCM WAV on a native thread; audio never passes through JS. */
export const createPcmVoiceRecorder =
  pcmRecorder === null ? null : () => createRecorder(pcmRecorder);
