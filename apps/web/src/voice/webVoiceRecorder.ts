import {
  VoiceTranscriptionError,
  voiceLevelFromDecibels,
  type VoiceRecorder,
  type VoiceRecorderStatus,
} from "@supaterm/client-runtime/voice-input";
import { TRANSCRIPTION_MIN_DURATION_MS, TranscriptionError } from "@supaterm/contracts";

import { type MicrophonePreference, openMicrophone } from "./microphone";
import pcmCaptureWorkletUrl from "./pcmCapture.worklet.ts?worker&url";
import { PCM_CAPTURE_PROCESSOR, VOICE_SAMPLE_RATE, wavFromPcm } from "./wav";

export const VOICE_LEVEL_HISTORY = 16;
// The worklet answers within a render quantum; a suspended context never would.
const FLUSH_TIMEOUT_MS = 1_000;

const DEV_FAKE_MICROPHONE_STORAGE_KEY = "supaterm:dev-fake-microphone";

/** Dev only: "1" plays a tone, a `data:` audio URL plays that recording, so tests can speak. */
function fakeMicrophoneSource(): string | null {
  if (!import.meta.env.DEV) return null;
  try {
    return window.localStorage.getItem(DEV_FAKE_MICROPHONE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function canRecordVoice(): boolean {
  return (
    fakeMicrophoneSource() !== null ||
    (window.isSecureContext &&
      typeof navigator.mediaDevices?.getUserMedia === "function" &&
      typeof AudioWorkletNode !== "undefined")
  );
}

export interface VoiceRecording {
  readonly audio: Blob;
  readonly durationMs: number;
}

// Keyed by object URL, the `uri` the shared controller passes around.
const recordings = new Map<string, VoiceRecording>();

export function readVoiceRecording(uri: string): VoiceRecording {
  const recording = recordings.get(uri);
  if (!recording) throw new Error("The recording is no longer available.");
  if (recording.durationMs < TRANSCRIPTION_MIN_DURATION_MS) {
    const { message } = new TranscriptionError({ reason: "audioTooShort" });
    throw new VoiceTranscriptionError("tooShort", message);
  }
  return recording;
}

export function releaseVoiceRecording(uri: string): void {
  if (!recordings.delete(uri)) return;
  URL.revokeObjectURL(uri);
}

export type VoiceLevelListener = (levels: ReadonlyArray<number>) => void;
/** Receives 16 kHz mono 16-bit PCM as it is recorded, about every 100 ms. */
export type VoicePcmListener = (pcm: Uint8Array) => void;

function levelOf(frame: Int16Array): number {
  let sum = 0;
  for (const sample of frame) sum += (sample / 32768) ** 2;
  return voiceLevelFromDecibels(10 * Math.log10(sum / Math.max(1, frame.length)));
}

export class WebVoiceRecorder implements VoiceRecorder {
  uri: string | null = null;
  private stream: MediaStream | null = null;
  private fakeSource: {
    readonly context: AudioContext;
    readonly start: () => void;
    readonly stop: () => void;
  } | null = null;
  private capture: { readonly context: AudioContext; readonly node: AudioWorkletNode } | null =
    null;
  private recording = false;
  private pcm: Array<Uint8Array> = [];
  private recordedSamples = 0;
  private readonly pcmListeners = new Set<VoicePcmListener>();
  private flushed: (() => void) | null = null;
  private startedAt = 0;
  private limitTimer: ReturnType<typeof setTimeout> | null = null;
  private levels: ReadonlyArray<number> = Array<number>(VOICE_LEVEL_HISTORY).fill(0);
  private levelListener: VoiceLevelListener | null = null;
  private stopped: Promise<void> | null = null;
  private permissionGeneration = 0;
  private readonly onStatus: (status: VoiceRecorderStatus) => void;
  private readonly readMicrophone: () => MicrophonePreference;

  constructor(options: {
    readonly onStatus: (status: VoiceRecorderStatus) => void;
    readonly readMicrophone: () => MicrophonePreference;
  }) {
    this.onStatus = options.onStatus;
    this.readMicrophone = options.readMicrophone;
  }

  get elapsedMs(): number {
    return this.recording ? performance.now() - this.startedAt : 0;
  }

  /** Follows the recording as it is made; returns the unsubscribe. */
  onPcm(listener: VoicePcmListener): () => void {
    this.pcmListeners.add(listener);
    return () => this.pcmListeners.delete(listener);
  }

  async requestPermission(): Promise<{
    granted: boolean;
    canAskAgain: boolean;
    reason?: string;
  }> {
    if (this.stream) return { granted: true, canAskAgain: true };
    const generation = this.permissionGeneration;
    const fakeSource = fakeMicrophoneSource();
    if (fakeSource !== null) {
      this.stream = await this.createFakeStream(fakeSource);
      return { granted: true, canAskAgain: true };
    }
    try {
      const stream = await openMicrophone(this.readMicrophone());
      if (generation !== this.permissionGeneration) {
        for (const track of stream.getTracks()) track.stop();
        return { granted: false, canAskAgain: true };
      }
      this.stream = stream;
      return { granted: true, canAskAgain: true };
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        return { granted: false, canAskAgain: false };
      }
      if (error instanceof DOMException && error.name === "NotFoundError") {
        return {
          granted: false,
          canAskAgain: true,
          reason: "No microphone was found. Connect one, then record again.",
        };
      }
      throw error;
    }
  }

  async prepareToRecordAsync(): Promise<void> {
    const stream = this.stream;
    if (!stream) throw new Error("The microphone is not open.");
    this.uri = null;
    this.pcm = [];
    this.recordedSamples = 0;
    this.closeCapture();
    const context = new AudioContext();
    try {
      await context.audioWorklet.addModule(pcmCaptureWorkletUrl);
      const node = new AudioWorkletNode(context, PCM_CAPTURE_PROCESSOR, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      node.port.onmessage = (event: MessageEvent) => {
        if (event.data instanceof Int16Array) this.receive(event.data);
        else if (event.data === "flushed") this.flushed?.();
      };
      // The node outputs silence; it only renders while connected to the destination.
      context.createMediaStreamSource(stream).connect(node).connect(context.destination);
      await context.resume();
      this.capture = { context, node };
    } catch (error) {
      void context.close().catch(() => undefined);
      throw error;
    }
    const capture = this.capture;
    for (const track of stream.getAudioTracks()) {
      track.addEventListener(
        "ended",
        () => {
          if (this.capture !== capture || !this.recording) return;
          void this.stop().then(() =>
            this.onStatus({
              isFinished: false,
              hasError: true,
              error: "The microphone was disconnected.",
              url: this.uri,
            }),
          );
        },
        { once: true },
      );
    }
    this.stopped = null;
  }

  record(options: { readonly forDuration: number }): void {
    const capture = this.capture;
    if (!capture || this.recording) return;
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- A MessagePort has no target origin.
    capture.node.port.postMessage("start");
    this.recording = true;
    this.fakeSource?.start();
    this.startedAt = performance.now();
    this.limitTimer = setTimeout(() => {
      if (this.capture !== capture || !this.recording) return;
      void this.stop().then(() =>
        this.onStatus({ isFinished: true, hasError: false, error: null, url: this.uri }),
      );
    }, options.forDuration * 1_000);
  }

  stop(): Promise<void> {
    this.stopped ??= this.finish();
    return this.stopped;
  }

  /** The meter reads levels here, outside React, so recording never re-renders the composer. */
  setLevelListener(listener: VoiceLevelListener | null): void {
    this.levelListener = listener;
    listener?.(this.levels);
  }

  release(): void {
    this.permissionGeneration += 1;
    if (this.limitTimer) clearTimeout(this.limitTimer);
    this.limitTimer = null;
    this.recording = false;
    this.resetLevels();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.fakeSource?.stop();
    this.fakeSource = null;
    this.closeCapture();
  }

  private receive(frame: Int16Array): void {
    if (!this.recording) return;
    const bytes = new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength);
    this.pcm.push(bytes);
    this.recordedSamples += frame.length;
    for (const listener of this.pcmListeners) listener(bytes);
    if (document.hidden) return;
    this.levels = [...this.levels.slice(1), levelOf(frame)];
    this.levelListener?.(this.levels);
  }

  private async finish(): Promise<void> {
    const capture = this.capture;
    if (this.limitTimer) clearTimeout(this.limitTimer);
    this.limitTimer = null;
    if (!capture || !this.recording) return;
    const elapsedMs = performance.now() - this.startedAt;
    await new Promise<void>((resolve) => {
      this.flushed = resolve;
      setTimeout(resolve, FLUSH_TIMEOUT_MS);
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- A MessagePort has no target origin.
      capture.node.port.postMessage("flush");
    });
    this.flushed = null;
    this.recording = false;
    this.resetLevels();
    this.closeCapture();
    // A tap can stop before the first frame; that is an empty recording, not a failure.
    if (this.recordedSamples === 0 && elapsedMs >= TRANSCRIPTION_MIN_DURATION_MS) return;
    const audio = wavFromPcm(this.pcm);
    this.pcm = [];
    const uri = URL.createObjectURL(audio);
    recordings.set(uri, {
      audio,
      durationMs: Math.round((this.recordedSamples / VOICE_SAMPLE_RATE) * 1000),
    });
    this.uri = uri;
  }

  private resetLevels(): void {
    this.levels = Array<number>(VOICE_LEVEL_HISTORY).fill(0);
    this.levelListener?.(this.levels);
  }

  private closeCapture(): void {
    const capture = this.capture;
    this.capture = null;
    if (!capture) return;
    capture.node.port.onmessage = null;
    capture.node.disconnect();
    void capture.context.close().catch(() => undefined);
  }

  private async createFakeStream(source: string): Promise<MediaStream> {
    const context = new AudioContext();
    const destination = context.createMediaStreamDestination();
    let node: AudioScheduledSourceNode;
    if (source.startsWith("data:")) {
      const player = context.createBufferSource();
      // The desktop CSP blocks fetching `data:` URLs.
      const bytes = Uint8Array.from(atob(source.slice(source.indexOf(",") + 1)), (char) =>
        char.charCodeAt(0),
      );
      player.buffer = await context.decodeAudioData(bytes.buffer);
      player.connect(destination);
      node = player;
    } else {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 220;
      gain.gain.value = 0.05;
      oscillator.connect(gain).connect(destination);
      node = oscillator;
    }
    let started = false;
    this.fakeSource = {
      context,
      start: () => {
        if (started) return;
        started = true;
        node.start();
      },
      stop: () => {
        if (started) node.stop();
        void context.close().catch(() => undefined);
      },
    };
    return destination.stream;
  }
}
