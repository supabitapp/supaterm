import type {
  VoiceRecorder,
  VoiceRecorderStatus,
  VoiceRecordingDescription,
} from "@supaterm/client-runtime/voice-input";

const MIME_TYPE_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];
const AUDIO_BITS_PER_SECOND = 32_000;
const LEVEL_SAMPLE_MS = 100;
export const DICTATION_LEVEL_PROPERTY = "--dictation-level";

export const DEV_FAKE_MICROPHONE_STORAGE_KEY = "supaterm:dev-fake-microphone";

function usesFakeMicrophone(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    return window.localStorage.getItem(DEV_FAKE_MICROPHONE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function preferredMimeType(): string | undefined {
  return MIME_TYPE_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

interface RecordedClip extends VoiceRecordingDescription {
  readonly blob: Blob;
}

const recordings = new Map<string, RecordedClip>();

export function readRecording(uri: string): RecordedClip | null {
  return recordings.get(uri) ?? null;
}

export function describeRecording(uri: string): VoiceRecordingDescription {
  const recording = recordings.get(uri);
  return {
    mimeType: recording?.mimeType ?? "audio/webm",
    durationMs: recording?.durationMs ?? 0,
  };
}

export function releaseRecording(uri: string): void {
  if (!recordings.delete(uri)) return;
  URL.revokeObjectURL(uri);
}

export type MicrophonePermission = { readonly granted: boolean; readonly canAskAgain: boolean };

export class WebVoiceRecorder implements VoiceRecorder {
  uri: string | null = null;
  private stream: MediaStream | null = null;
  private fakeSource: { readonly context: AudioContext; readonly stop: () => void } | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private limitTimer: ReturnType<typeof setTimeout> | null = null;
  private levelContext: AudioContext | null = null;
  private levelTimer: ReturnType<typeof setInterval> | null = null;
  private levelTarget: HTMLElement | null = null;
  private stopped: Promise<void> | null = null;
  private permissionGeneration = 0;
  private readonly onStatus: (status: VoiceRecorderStatus) => void;

  constructor(options: { readonly onStatus: (status: VoiceRecorderStatus) => void }) {
    this.onStatus = options.onStatus;
  }

  get elapsedMs(): number | null {
    return this.mediaRecorder?.state === "recording" ? performance.now() - this.startedAt : null;
  }

  async requestPermission(): Promise<MicrophonePermission> {
    if (this.stream) return { granted: true, canAskAgain: true };
    const generation = this.permissionGeneration;
    if (usesFakeMicrophone()) {
      this.stream = this.createFakeStream();
      return { granted: true, canAskAgain: true };
    }
    const desktopAccess = await window.desktopBridge?.requestMicrophoneAccess?.();
    if (generation !== this.permissionGeneration) return { granted: false, canAskAgain: true };
    if (desktopAccess && !desktopAccess.granted) return desktopAccess;
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
      const denied = error instanceof DOMException && error.name === "NotAllowedError";
      if (!denied) throw error;
      return { granted: false, canAskAgain: false };
    }
  }

  async prepareToRecordAsync(): Promise<void> {
    const stream = this.stream;
    if (!stream) throw new Error("The microphone is not open.");
    this.uri = null;
    this.chunks = [];
    const mimeType = preferredMimeType();
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

  setLevelTarget(element: HTMLElement | null): void {
    this.levelTarget?.style.removeProperty(DICTATION_LEVEL_PROPERTY);
    this.levelTarget = element;
  }

  releaseIfUnused(): void {
    if (this.mediaRecorder === null) this.release();
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
    const mimeType = recorder.mimeType || this.chunks[0]?.type || "audio/webm";
    const blob = new Blob(this.chunks, { type: mimeType });
    this.chunks = [];
    if (blob.size === 0) return;
    const uri = URL.createObjectURL(blob);
    recordings.set(uri, { blob, mimeType, durationMs });
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
    let previous = -1;
    this.levelTimer = setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        const centered = (sample - 128) / 128;
        sum += centered * centered;
      }
      const level = Math.min(1, Math.round(Math.sqrt(sum / samples.length) * 40) / 10);
      if (level === previous) return;
      previous = level;
      this.levelTarget?.style.setProperty(DICTATION_LEVEL_PROPERTY, String(level));
    }, LEVEL_SAMPLE_MS);
  }

  private stopLevelMeter(): void {
    if (this.levelTimer) clearInterval(this.levelTimer);
    this.levelTimer = null;
    this.levelTarget?.style.removeProperty(DICTATION_LEVEL_PROPERTY);
    void this.levelContext?.close().catch(() => undefined);
    this.levelContext = null;
  }

  private createFakeStream(): MediaStream {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 220;
    gain.gain.value = 0.05;
    const destination = context.createMediaStreamDestination();
    oscillator.connect(gain).connect(destination);
    oscillator.start();
    this.fakeSource = {
      context,
      stop: () => {
        oscillator.stop();
        void context.close().catch(() => undefined);
      },
    };
    return destination.stream;
  }
}
