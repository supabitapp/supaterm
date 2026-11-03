// @effect-diagnostics nodeBuiltinImport:off - the dictation WebSocket adapter owns native socket events.
import type * as NodeHttp from "node:http";

import { TranscriptionError } from "@supaterm/contracts";
import {
  LiveTranscriptionUnavailable,
  PCM_BYTES_PER_SECOND,
} from "@supaterm/provider-core/server/transcription";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import WebSocket from "ws";

export const CODEX_DICTATION_STREAM_URL =
  "wss://chatgpt.com/backend-api/dictation/stream?dictation_surface=composer&client_type=desktop";
const PROTOCOLS = ["chatgpt-dictation", "codex-desktop"];
const SAMPLE_RATE = 16_000;
const CONNECT_TIMEOUT = "15 seconds";
const MIN_CLOSE_DEADLINE_MS = 15_000;
// A session lives 300 s. Rotate in a pause after 240 s of audio, and at 285 s regardless.
const ROTATE_AFTER_BYTES = 240 * PCM_BYTES_PER_SECOND;
const FORCE_ROTATE_BYTES = 285 * PCM_BYTES_PER_SECOND;
// The desktop app's audio worklet posts one 128-sample render quantum, then 2048-sample
// frames, and pads every session with 250 ms of silence before closing it.
const FIRST_FRAME_BYTES = 128 * 2;
const FRAME_BYTES = 2048 * 2;
const CLOSING_SILENCE = new Uint8Array(PCM_BYTES_PER_SECOND / 4);
/** The desktop app sends the system's first preferred language. */
export const ACCEPT_LANGUAGE = Intl.DateTimeFormat().resolvedOptions().locale;

const Frame = Schema.fromJsonString(
  Schema.Struct({
    type: Schema.String,
    utterance_id: Schema.optional(Schema.NullOr(Schema.String)),
    revision: Schema.optional(Schema.Number),
    text: Schema.optional(Schema.String),
    fatal: Schema.optional(Schema.Boolean),
    session: Schema.optional(Schema.Struct({ status: Schema.optional(Schema.String) })),
  }),
);
const decodeFrame = Schema.decodeUnknownOption(Frame);
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

export interface DictationState {
  readonly started: boolean;
  readonly speaking: boolean;
  readonly stopRequested: boolean;
  /** Utterances in the order they first appeared, each at its newest revision. */
  readonly finals: ReadonlyMap<string, { readonly revision: number; readonly text: string }>;
}

export const initialDictationState: DictationState = {
  started: false,
  speaking: false,
  stopRequested: false,
  finals: new Map(),
};

export type DictationStep =
  | { readonly _tag: "Continue"; readonly state: DictationState }
  | { readonly _tag: "Done"; readonly text: string }
  | { readonly _tag: "Failed" };

const dictationText = (state: DictationState) =>
  [...state.finals.values()]
    .flatMap((final) => (final.text.trim() ? [final.text.trim()] : []))
    .join(" ");

/** The session is over only once the server reports it closed; finals before that can still be revised. */
export function stepDictation(state: DictationState, data: string): DictationStep {
  const frame = Option.getOrUndefined(decodeFrame(data));
  switch (frame?.type) {
    case "session.started":
      return { _tag: "Continue", state: { ...state, started: true } };
    case "speech.started":
      return { _tag: "Continue", state: { ...state, speaking: true } };
    case "speech.stopped":
      return { _tag: "Continue", state: { ...state, speaking: false } };
    case "session.stop_requested":
      return { _tag: "Continue", state: { ...state, stopRequested: true } };
    case "transcript.final": {
      const id = frame.utterance_id;
      const revision = frame.revision ?? 0;
      const current = id ? state.finals.get(id) : undefined;
      if (!id || (current && current.revision > revision)) return { _tag: "Continue", state };
      const finals = new Map(state.finals).set(id, { revision, text: frame.text ?? "" });
      return { _tag: "Continue", state: { ...state, finals } };
    }
    case "transcript.failed":
      return { _tag: "Failed" };
    case "session.error":
      return frame.fatal ? { _tag: "Failed" } : { _tag: "Continue", state };
    case "session.updated":
      return frame.session?.status === "closed"
        ? { _tag: "Done", text: dictationText(state) }
        : { _tag: "Continue", state };
    default:
      return { _tag: "Continue", state };
  }
}

export interface DictationLogin {
  readonly accessToken: string;
  readonly accountId: string;
}

function dictationUpgradeError(
  status: number | undefined,
  headers: NodeHttp.IncomingHttpHeaders,
): TranscriptionError {
  if (headers["cf-mitigated"] !== undefined) return new TranscriptionError({ reason: "blocked" });
  if (status === 401) return new TranscriptionError({ reason: "signedOut" });
  if (status === 403 || status === 404 || status === 410) {
    return new TranscriptionError({ reason: "blocked" });
  }
  if (status === 429) return new TranscriptionError({ reason: "rateLimited" });
  return new TranscriptionError({ reason: "failed" });
}

interface Live {
  readonly session: Session;
  readonly scope: Scope.Closeable;
  bytes: number;
}

interface Session {
  readonly send: (chunk: Uint8Array) => Effect.Effect<void, TranscriptionError>;
  /** Ends the audio and waits for the server's final word on this session. */
  readonly close: (audioMs: number) => Effect.Effect<string, TranscriptionError>;
  readonly speaking: Effect.Effect<boolean>;
}

const openSession = Effect.fnUntraced(function* (input: {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly language: string | undefined;
  readonly onStopRequested: Effect.Effect<void>;
}): Effect.fn.Return<Session, TranscriptionError, Scope.Scope> {
  const events = yield* Queue.unbounded<
    { readonly _tag: "Message"; readonly data: string } | { readonly _tag: "Closed" }
  >();
  const socket = yield* Effect.acquireRelease(
    Effect.callback<WebSocket, TranscriptionError>((resume) => {
      const ws = new WebSocket(input.url, PROTOCOLS, {
        headers: input.headers,
        followRedirects: false,
      });
      ws.once("unexpected-response", (_request, response) => {
        response.resume();
        ws.terminate();
        resume(Effect.fail(dictationUpgradeError(response.statusCode, response.headers)));
      });
      ws.once("error", (cause) =>
        resume(Effect.fail(new TranscriptionError({ reason: "failed", cause }))),
      );
      ws.once("open", () => {
        ws.removeAllListeners("error");
        ws.on("error", () => Queue.offerUnsafe(events, { _tag: "Closed" }));
        ws.on("message", (data, isBinary) => {
          if (!isBinary) Queue.offerUnsafe(events, { _tag: "Message", data: data.toString() });
        });
        ws.on("close", () => Queue.offerUnsafe(events, { _tag: "Closed" }));
        resume(Effect.succeed(ws));
      });
      return Effect.sync(() => ws.terminate());
    }).pipe(
      Effect.timeoutOrElse({
        duration: CONNECT_TIMEOUT,
        orElse: () => Effect.fail(new TranscriptionError({ reason: "failed" })),
      }),
    ),
    (ws) => Effect.sync(() => ws.terminate()),
  );
  const send = (frame: unknown) =>
    Effect.callback<void, TranscriptionError>((resume) => {
      socket.send(encodeJson(frame), (cause) =>
        resume(
          cause ? Effect.fail(new TranscriptionError({ reason: "failed", cause })) : Effect.void,
        ),
      );
    });

  const state = yield* Ref.make(initialDictationState);
  const started = yield* Deferred.make<void, TranscriptionError>();
  const done = yield* Deferred.make<string, TranscriptionError>();
  yield* Effect.forkScoped(
    Effect.gen(function* () {
      while (true) {
        const event = yield* Queue.take(events);
        if (event._tag === "Closed") {
          return yield* new TranscriptionError({ reason: "failed" });
        }
        const previous = yield* Ref.get(state);
        const step = stepDictation(previous, event.data);
        if (step._tag === "Failed") return yield* new TranscriptionError({ reason: "failed" });
        if (step._tag === "Done") return step.text;
        yield* Ref.set(state, step.state);
        if (step.state.started) yield* Deferred.succeed(started, undefined);
        if (step.state.stopRequested && !previous.stopRequested) yield* input.onStopRequested;
      }
    }).pipe(
      Effect.exit,
      Effect.flatMap((exit) =>
        Effect.andThen(Deferred.done(started, Exit.asVoid(exit)), Deferred.done(done, exit)),
      ),
    ),
  );

  // The desktop composer's start: no session ids, segments for its live preview, server stops honored.
  yield* send({
    type: "session.start",
    client_capabilities: ["server_stop_requested"],
    config: {
      ...(input.language === undefined ? {} : { language: input.language }),
      input_audio_format: "pcm16",
      sample_rate_hz: SAMPLE_RATE,
      num_channels: 1,
      max_buffer_size_bytes: 4_194_304,
      max_utterance_duration_ms: 30_000,
      session_ttl_ms: 300_000,
      provider_mode: "streaming_sse",
      transcript_delivery_mode: "segment",
      vad: { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 500 },
    },
  });
  yield* Deferred.await(started).pipe(
    Effect.timeoutOrElse({
      duration: CONNECT_TIMEOUT,
      orElse: () => Effect.fail(new TranscriptionError({ reason: "failed" })),
    }),
  );

  return {
    send: (chunk) => send({ type: "audio.append", audio: Buffer.from(chunk).toString("base64") }),
    close: (audioMs) =>
      send({ type: "session.close" }).pipe(
        Effect.andThen(Deferred.await(done)),
        Effect.timeoutOrElse({
          duration: Math.max(MIN_CLOSE_DEADLINE_MS, audioMs),
          orElse: () => Effect.fail(new TranscriptionError({ reason: "failed" })),
        }),
      ),
    speaking: Effect.map(Ref.get(state), (current) => current.speaking),
  };
});

/**
 * Streams `audio` to Codex dictation, one vendor session after another. Opening the first
 * session spends nothing, so its failure is `LiveTranscriptionUnavailable`. `headers` reads
 * the login; with `refresh` it renews it first, once, after the server said signed out.
 */
export const streamCodexDictation = Effect.fn("CodexDictation.stream")(function* (input: {
  readonly url: string;
  readonly headers: (refresh: boolean) => Effect.Effect<Record<string, string>, TranscriptionError>;
  readonly language: string | undefined;
  readonly audio: Stream.Stream<Uint8Array>;
}) {
  const stopRequests = yield* Queue.unbounded<Scope.Closeable>();
  const open = Effect.gen(function* () {
    const scope = yield* Scope.make();
    const attempt = (refresh: boolean) =>
      Effect.flatMap(input.headers(refresh), (headers) =>
        openSession({
          url: input.url,
          headers,
          language: input.language,
          onStopRequested: Queue.offer(stopRequests, scope).pipe(Effect.asVoid),
        }),
      );
    const session = yield* attempt(false).pipe(
      Effect.catchIf(
        (error) => error.reason === "signedOut",
        () => attempt(true),
      ),
      Scope.provide(scope),
      Effect.onError(() => Scope.close(scope, Exit.void)),
    );
    const opened: Live = { session, scope, bytes: 0 };
    return opened;
  });

  let live: Live | undefined;
  return yield* Effect.gen(function* () {
    live = yield* open.pipe(
      Effect.mapError((cause) => new LiveTranscriptionUnavailable({ cause })),
    );
    const texts: Array<string> = [];
    const finish = Effect.gen(function* () {
      const current = live;
      if (current === undefined) return;
      if (current.bytes > 0) yield* current.session.send(CLOSING_SILENCE);
      const text = yield* current.session.close((current.bytes / PCM_BYTES_PER_SECOND) * 1000);
      yield* Scope.close(current.scope, Exit.void);
      live = undefined;
      if (text) texts.push(text);
    });
    // Untraced, like `append`: both run for every chunk or frame of audio.
    const sendFrame = Effect.fnUntraced(function* (frame: Uint8Array) {
      let current = live;
      if (current !== undefined) {
        const due =
          current.bytes >= FORCE_ROTATE_BYTES ||
          (current.bytes >= ROTATE_AFTER_BYTES && !(yield* current.session.speaking));
        if (due) {
          yield* finish;
          current = undefined;
        }
      }
      if (current === undefined) {
        current = yield* open;
        live = current;
      }
      yield* current.session.send(frame);
      current.bytes += frame.byteLength;
    });

    let pending: Uint8Array = new Uint8Array(0);
    let frameBytes = FIRST_FRAME_BYTES;
    const append = Effect.fnUntraced(function* (chunk: Uint8Array) {
      pending = Buffer.concat([pending, chunk]);
      while (pending.byteLength >= frameBytes) {
        yield* sendFrame(pending.subarray(0, frameBytes));
        pending = pending.subarray(frameBytes);
        frameBytes = FRAME_BYTES;
      }
    });
    // Like the desktop worklet at a session boundary, the partial frame goes out with the old session.
    const stop = Effect.gen(function* () {
      const current = live;
      if (current === undefined) return;
      if (pending.byteLength > 0) {
        yield* current.session.send(pending);
        current.bytes += pending.byteLength;
        pending = new Uint8Array(0);
      }
      yield* finish;
    });
    // A stop request closes its session even while no audio arrives; the next frame opens another.
    yield* Stream.merge(
      Stream.map(input.audio, (chunk) => ({ _tag: "Audio", chunk }) as const),
      Stream.map(Stream.fromQueue(stopRequests), (scope) => ({ _tag: "Stop", scope }) as const),
      { haltStrategy: "left" },
    ).pipe(
      Stream.runForEach((event) => {
        if (event._tag === "Audio") return append(event.chunk);
        return event.scope === live?.scope ? stop : Effect.void;
      }),
    );
    if (pending.byteLength > 0) yield* sendFrame(pending);
    yield* finish;
    return texts.join(" ");
  }).pipe(
    Effect.ensuring(
      Effect.suspend(() => (live === undefined ? Effect.void : Scope.close(live.scope, Exit.void))),
    ),
  );
});

export const codexDictationHeaders = (login: DictationLogin, userAgent: string) => ({
  "Accept-Language": ACCEPT_LANGUAGE,
  Authorization: `Bearer ${login.accessToken}`,
  "ChatGPT-Account-Id": login.accountId,
  originator: "Codex Desktop",
  "User-Agent": userAgent,
});
