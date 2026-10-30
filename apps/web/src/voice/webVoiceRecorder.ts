import type { VoiceRecorder, VoiceRecorderStatus } from "@supaterm/client-runtime/voice-input";

import { convertRecordingToWav } from "./wav";

const MIME_TYPE_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];
const AUDIO_BITS_PER_SECOND = 32_000;
const LEVEL_SAMPLE_MS = 100;
export const VOICE_LEVEL_HISTORY = 16;

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

function usesFakeMicrophone(): boolean {
  return fakeMicrophoneSource() !== null;
}

export function canRecordVoice(): boolean {
  return (
    usesFakeMicrophone() ||
    (window.isSecureContext &&
      typeof navigator.mediaDevices?.getUserMedia === "function" &&
      typeof MediaRecorder !== "undefined")
  );
}

export interface VoiceRecording {
  readonly audio: Blob;
  readonly durationMs: number;
}

// Keyed by object URL, the `uri` the shared controller passes around.
const recordings = new Map<string, VoiceRecording>();

export function readVoiceRecording(uri: string): VoiceRecording | null {
  return recordings.get(uri) ?? null;
}

export function releaseVoiceRecording(uri: string): void {
  if (!recordings.delete(uri)) return;
  URL.revokeObjectURL(uri);
}

export type VoiceLevelListener = (levels: ReadonlyArray<number>) => void;

export class WebVoiceRecorder implements VoiceRecorder {
  uri: string | null = null;
  private stream: MediaStream | null = null;
  private fakeSource: {
    readonly context: AudioContext;
    readonly start: () => void;
    readonly stop: () => void;
  } | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private limitTimer: ReturnType<typeof setTimeout> | null = null;
  private levelContext: AudioContext | null = null;
  private levelTimer: ReturnType<typeof setInterval> | null = null;
  private levels: ReadonlyArray<number> = Array<number>(VOICE_LEVEL_HISTORY).fill(0);
  private levelListener: VoiceLevelListener | null = null;
  private stopped: Promise<void> | null = null;
  private permissionGeneration = 0;
  private readonly onStatus: (status: VoiceRecorderStatus) => void;

  constructor(options: { readonly onStatus: (status: VoiceRecorderStatus) => void }) {
    this.onStatus = options.onStatus;
  }

  get elapsedMs(): number {
    return this.mediaRecorder?.state === "recording" ? performance.now() - this.startedAt : 0;
  }

  async requestPermission(): Promise<{ granted: boolean; canAskAgain: boolean }> {
    if (this.stream) return { granted: true, canAskAgain: true };
    const generation = this.permissionGeneration;
    const fakeSource = fakeMicrophoneSource();
    if (fakeSource !== null) {
      this.stream = await this.createFakeStream(fakeSource);
      return { granted: true, canAskAgain: true };
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
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
      throw error;
    }
  }

  async prepareToRecordAsync(): Promise<void> {
    const stream = this.stream;
    if (!stream) throw new Error("The microphone is not open.");
    this.uri = null;
    this.chunks = [];
    const mimeType = MIME_TYPE_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
    });
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    });
    recorder.addEventListener("error", () => {
      this.onStatus({
        isFinished: false,
        hasError: true,
        error: "Microphone recording failed.",
        url: null,
      });
    });
    for (const track of stream.getAudioTracks()) {
      track.addEventListener(
        "ended",
        () => {
          if (this.mediaRecorder !== recorder || recorder.state !== "recording") return;
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
    this.mediaRecorder = recorder;
    this.stopped = null;
  }

  record(options: { readonly forDuration: number }): void {
    const recorder = this.mediaRecorder;
    if (!recorder || recorder.state !== "inactive") return;
    recorder.start(1_000);
    this.fakeSource?.start();
    this.startedAt = performance.now();
    this.startLevelMeter();
    this.limitTimer = setTimeout(() => {
      if (this.mediaRecorder !== recorder || recorder.state !== "recording") return;
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
    this.stopLevelMeter();
    if (this.limitTimer) clearTimeout(this.limitTimer);
    this.limitTimer = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.fakeSource?.stop();
    this.fakeSource = null;
    if (this.mediaRecorder?.state === "recording") this.mediaRecorder.stop();
    this.mediaRecorder = null;
  }

  private async finish(): Promise<void> {
    const recorder = this.mediaRecorder;
    if (this.limitTimer) clearTimeout(this.limitTimer);
    this.limitTimer = null;
    this.stopLevelMeter();
    if (!recorder || recorder.state === "inactive") return;
    const stopped = new Promise<void>((resolve) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
    });
    recorder.stop();
    await stopped;
    const durationMs = Math.max(0, Math.round(performance.now() - this.startedAt));
    const encoded = new Blob(this.chunks, {
      type: recorder.mimeType || this.chunks[0]?.type || "audio/webm",
    });
    this.chunks = [];
    if (encoded.size === 0) return;
    const audio = await convertRecordingToWav(encoded);
    const uri = URL.createObjectURL(audio);
    recordings.set(uri, { audio, durationMs });
    this.uri = uri;
  }

  private startLevelMeter(): void {
    const stream = this.stream;
    if (!stream || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const context = this.fakeSource?.context ?? new AudioContext();
    if (!this.fakeSource) this.levelContext = context;
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    this.levelTimer = setInterval(() => {
      if (document.hidden) return;
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        const centered = (sample - 128) / 128;
        sum += centered * centered;
      }
      const level = Math.min(1, Math.sqrt(Math.sqrt(sum / samples.length) * 4));
      this.levels = [...this.levels.slice(1), level];
      this.levelListener?.(this.levels);
    }, LEVEL_SAMPLE_MS);
  }

  private stopLevelMeter(): void {
    if (this.levelTimer) clearInterval(this.levelTimer);
    this.levelTimer = null;
    this.levels = Array<number>(VOICE_LEVEL_HISTORY).fill(0);
    this.levelListener?.(this.levels);
    void this.levelContext?.close().catch(() => undefined);
    this.levelContext = null;
  }

  private async createFakeStream(source: string): Promise<MediaStream> {
    const context = new AudioContext();
    const destination = context.createMediaStreamDestination();
    let node: AudioScheduledSourceNode;
    if (source.startsWith("data:")) {
      const player = context.createBufferSource();
      player.buffer = await context.decodeAudioData(await (await fetch(source)).arrayBuffer());
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
