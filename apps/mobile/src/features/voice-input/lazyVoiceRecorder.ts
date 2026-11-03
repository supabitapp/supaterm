import type { VoiceRecorder } from "@supaterm/client-runtime/voice-input";

type Subscription = { remove(): void };

export interface VoiceRecordingInput {
  readonly uid: string;
  readonly name: string;
  readonly type: string;
}

export interface VoiceRecordingStatusEvent {
  readonly isFinished: boolean;
  readonly hasError: boolean;
  readonly error: string | null;
  readonly url: string | null;
}

export interface VoiceRecordingState {
  readonly isRecording: boolean;
  readonly durationMillis: number;
  readonly metering?: number;
}

export interface NativeVoiceRecorder<TStatus, TRecorderState> {
  readonly uri: string | null;
  prepareToRecordAsync(): Promise<void>;
  record(options: { readonly forDuration: number }): void;
  stop(): Promise<void>;
  getStatus(): TRecorderState;
  addListener(
    eventName: "recordingStatusUpdate",
    listener: (status: TStatus) => void,
  ): Subscription;
  /** 16 kHz mono 16-bit PCM, byte for byte what the recording's WAV data holds. */
  addFrameListener(listener: (pcm: Uint8Array) => void): Subscription;
  getAvailableInputs(): ReadonlyArray<VoiceRecordingInput>;
  setInput(uid: string): void;
  release(): void;
}

export interface LazyVoiceRecorder<TRecorderState> extends VoiceRecorder {
  getStatus(): TRecorderState | null;
  /** Works before the recorder exists, so a dictation can subscribe before it is prepared. */
  subscribeFrames(push: (pcm: Uint8Array) => void): () => void;
  release(): void;
}

/** Construct lazily: cold startup blocks JS for tens of milliseconds and most composers never record. */
export function createLazyVoiceRecorder<TStatus, TRecorderState>(input: {
  readonly create: () => NativeVoiceRecorder<TStatus, TRecorderState>;
  readonly onStatus: (status: TStatus) => void;
  readonly selectInput?: (inputs: ReadonlyArray<VoiceRecordingInput>) => VoiceRecordingInput | null;
}): LazyVoiceRecorder<TRecorderState> {
  let recorder: NativeVoiceRecorder<TStatus, TRecorderState> | null = null;
  let subscription: Subscription | null = null;
  const frameListeners = new Set<(pcm: Uint8Array) => void>();
  let frameSubscription: Subscription | null = null;
  let retired: NativeVoiceRecorder<TStatus, TRecorderState> | null = null;
  let retiredUri: string | null = null;
  let pending: Promise<unknown> = Promise.resolve();

  const track = <T>(promise: Promise<T>): Promise<T> => {
    pending = Promise.allSettled([pending, promise]).then(() => undefined);
    return promise;
  };

  // Listening is what makes the native recorder emit frames, so it only listens while asked to.
  const syncFrameSubscription = () => {
    if (recorder && frameListeners.size > 0) {
      frameSubscription ??= recorder.addFrameListener((pcm) => {
        for (const listener of frameListeners) listener(pcm);
      });
    } else {
      frameSubscription?.remove();
      frameSubscription = null;
    }
  };

  return {
    get uri() {
      if (recorder) return recorder.uri;
      return retired ? retired.uri : retiredUri;
    },
    prepareToRecordAsync() {
      if (!recorder) {
        recorder = input.create();
        subscription = recorder.addListener("recordingStatusUpdate", input.onStatus);
        syncFrameSubscription();
      }
      const prepared = recorder;
      return track(
        prepared.prepareToRecordAsync().then(() => {
          if (!input.selectInput) return;
          try {
            const selected = input.selectInput(prepared.getAvailableInputs());
            if (selected) prepared.setInput(selected.uid);
          } catch {}
        }),
      );
    },
    record(options) {
      if (!recorder) throw new Error("Voice recorder is not prepared.");
      recorder.record(options);
    },
    stop() {
      return recorder ? track(recorder.stop()) : Promise.resolve();
    },
    getStatus() {
      return recorder ? recorder.getStatus() : null;
    },
    subscribeFrames(push) {
      frameListeners.add(push);
      syncFrameSubscription();
      return () => {
        frameListeners.delete(push);
        syncFrameSubscription();
      };
    },
    release() {
      const released = recorder;
      if (!released) return;
      recorder = null;
      subscription?.remove();
      subscription = null;
      syncFrameSubscription();
      retired = released;
      void pending.then(() => {
        if (retired === released) {
          retiredUri = released.uri;
          retired = null;
        }
        released.release();
      });
    },
  };
}
