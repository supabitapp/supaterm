// @effect-diagnostics globalTimers:off - Dictation streams from web and native recorder callbacks, outside an Effect runtime.
import {
  TRANSCRIPTION_STREAM_CLOSED_CODE,
  TranscriptionStreamServerMessage,
} from "@supaterm/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** The part of a browser or React Native WebSocket a dictation uses. */
export interface LiveDictationSocket {
  readonly bufferedAmount: number;
  send(data: string | ArrayBuffer): void;
  close(code?: number): void;
}

/** What the platform reports from the socket it opened; an error must end in `close`. */
export interface LiveDictationSocketEvents {
  readonly message: (data: unknown) => void;
  readonly close: (code: number) => void;
}

export interface LiveDictationOptions {
  /** Resolves the stream's WebSocket URL; a rejection leaves the recording to be uploaded. */
  readonly prepare: () => Promise<string>;
  readonly openSocket: (url: string, events: LiveDictationSocketEvents) => LiveDictationSocket;
  /** Delivers each 16 kHz mono 16-bit PCM frame as it is recorded; returns an unsubscribe. */
  readonly subscribe: (push: (pcm: Uint8Array) => void) => () => void;
}

/** Opens the stream with the WebSocket that browsers and React Native share. */
export function openLiveDictationSocket(
  url: string,
  events: LiveDictationSocketEvents,
): LiveDictationSocket {
  const socket = new WebSocket(url);
  socket.onmessage = (event) => events.message(event.data);
  socket.onclose = (event) => events.close(event.code);
  socket.onerror = () => socket.close();
  return socket;
}

const decodeServerMessage = Schema.decodeUnknownOption(
  Schema.fromJsonString(TranscriptionStreamServerMessage),
);

const RECONNECT_DELAYS_MS = [250, 1_000, 2_000];
// More than this unsent means the link can't keep up; the recording goes up whole instead.
const MAX_BUFFERED_BYTES = 512 * 1024;
const FINISH_TIMEOUT_MS = 5_000;

/**
 * Streams a recording to the environment while it is made. The stream only carries audio:
 * `finish` says whether the server holds all of it, in which case an upload with an empty body
 * collects the transcript; otherwise the upload sends the recording, and the server uses it to
 * fill in what the stream missed.
 */
export class LiveDictation {
  private readonly options: LiveDictationOptions;
  private readonly frames: Array<Uint8Array> = [];
  private recordedBytes = 0;
  private url: string | null = null;
  private socket: LiveDictationSocket | null = null;
  /** Bytes the server holds or has been sent on the open socket; null until it says `ready`. */
  private sentBytes: number | null = null;
  private reconnects = 0;
  private state: "streaming" | "finishing" | "done" = "streaming";
  private settleFinish: ((streamed: boolean) => void) | null = null;
  private readonly finished: Promise<boolean>;
  private readonly unsubscribe: () => void;

  constructor(options: LiveDictationOptions) {
    this.options = options;
    this.finished = new Promise((resolve) => {
      this.settleFinish = resolve;
    });
    this.unsubscribe = options.subscribe((pcm) => this.push(pcm));
    options.prepare().then(
      (url) => {
        if (this.state === "done") return;
        this.url = url;
        this.connect();
      },
      () => this.settle(false),
    );
  }

  /** Resolves `true` once the server holds every frame, `false` when the recording must be uploaded. */
  finish(): Promise<boolean> {
    if (this.state === "streaming") {
      this.state = "finishing";
      this.unsubscribe();
      this.sendFinish();
      setTimeout(() => this.settle(false), FINISH_TIMEOUT_MS);
    }
    return this.finished;
  }

  /** Stops streaming without finishing, as when the recording is discarded. */
  close(): void {
    this.settle(false);
  }

  private push(pcm: Uint8Array): void {
    if (this.state !== "streaming" || pcm.byteLength === 0) return;
    this.frames.push(pcm);
    this.recordedBytes += pcm.byteLength;
    if (this.sentBytes !== null) this.flush();
  }

  private connect(): void {
    if (this.url === null || this.state === "done") return;
    this.sentBytes = null;
    try {
      this.open(this.url);
    } catch {
      this.settle(false);
    }
  }

  private open(url: string): void {
    const socket = this.options.openSocket(url, {
      message: (data) => {
        if (this.socket !== socket || typeof data !== "string") return;
        const message = Option.getOrUndefined(decodeServerMessage(data));
        if (message?.type === "ready") {
          this.reconnects = 0;
          this.sentBytes = message.receivedBytes;
          this.flush();
          if (this.state === "finishing") this.sendFinish();
        } else if (message?.type === "finished") {
          this.settle(true);
        }
      },
      close: (code) => {
        if (this.socket !== socket) return;
        this.socket = null;
        this.sentBytes = null;
        if (this.state === "done") return;
        if (
          code === TRANSCRIPTION_STREAM_CLOSED_CODE ||
          this.reconnects >= RECONNECT_DELAYS_MS.length
        ) {
          this.settle(false);
          return;
        }
        setTimeout(() => this.connect(), RECONNECT_DELAYS_MS[this.reconnects++]);
      },
    });
    this.socket = socket;
  }

  private flush(): void {
    const socket = this.socket;
    if (socket === null || this.sentBytes === null) return;
    let offset = 0;
    for (const frame of this.frames) {
      const end = offset + frame.byteLength;
      if (end > this.sentBytes) {
        const unsent = frame.subarray(Math.max(0, this.sentBytes - offset));
        socket.send(unsent.slice().buffer);
        this.sentBytes += unsent.byteLength;
      }
      offset = end;
    }
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) this.settle(false);
  }

  private sendFinish(): void {
    if (this.sentBytes === null || this.sentBytes < this.recordedBytes) return;
    this.socket?.send('{"type":"finish"}');
  }

  private settle(streamed: boolean): void {
    if (this.state === "done") return;
    this.state = "done";
    this.unsubscribe();
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000);
    this.settleFinish?.(streamed);
  }
}
