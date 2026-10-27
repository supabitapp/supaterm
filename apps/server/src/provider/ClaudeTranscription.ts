// @effect-diagnostics nodeBuiltinImport:off - the voice WebSocket adapter owns native socket events.
import type * as NodeHttp from "node:http";

import { TranscriptionError } from "@supaterm/contracts";
import type { ProviderTranscription, WavAudio } from "@supaterm/provider-core/server/transcription";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/process";
import WebSocket from "ws";

import { readClaudeOAuthToken } from "./ClaudeOAuthToken.ts";

const VOICE_STREAM_URL = "wss://api.anthropic.com/api/ws/speech_to_text/voice_stream";
const FRAME_BYTES = 32_000;
const KEEP_ALIVE = '{"type":"KeepAlive"}';
const CLOSE_STREAM = '{"type":"CloseStream"}';
const KEEP_ALIVE_INTERVAL = "8 seconds";
const CONNECT_TIMEOUT = "15 seconds";
// A 278 s clip sent at once closed 60 s after CloseStream.
const MIN_DEADLINE_MS = 15_000;
const MAX_KEYTERMS = 50;
const MAX_KEYTERM_CHARS = 1_024;
const FALLBACK_CLI_VERSION = "2.1.310";
const NORMAL_CLOSE_CODES = new Set([1000, 1005]);

const CLAUDE_VOICE_LANGUAGES: ReadonlySet<string> = new Set([
  "en",
  "es",
  "fr",
  "ja",
  "de",
  "pt",
  "it",
  "ko",
  "hi",
  "id",
  "ru",
  "pl",
  "tr",
  "nl",
  "uk",
  "el",
  "cs",
  "da",
  "sv",
  "no",
]);

/** The Claude CLI's rules: commas split terms, so they become spaces; ASCII only. */
export function claudeKeytermsHeader(terms: ReadonlyArray<string>): string {
  const seen = new Set<string>();
  const kept: string[] = [];
  let length = 0;
  for (const term of terms) {
    const clean = term
      .replace(/,/g, " ")
      .replace(/[^\x20-\x7E]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    const cost = clean.length + (kept.length > 0 ? 1 : 0);
    if (kept.length === MAX_KEYTERMS || length + cost > MAX_KEYTERM_CHARS) break;
    seen.add(key);
    kept.push(clean);
    length += cost;
  }
  return kept.join(",");
}

export type VoiceStreamEvent =
  | { readonly _tag: "Message"; readonly data: string }
  | { readonly _tag: "CloseStreamSent" }
  | { readonly _tag: "Closed"; readonly code: number }
  | { readonly _tag: "Deadline" };

interface VoiceStreamState {
  readonly committed: ReadonlyArray<string>;
  readonly pending: string;
  readonly closeStreamSent: boolean;
}

type VoiceStreamStep =
  | { readonly _tag: "Continue"; readonly state: VoiceStreamState }
  | { readonly _tag: "Done"; readonly text: string }
  | { readonly _tag: "Failed"; readonly error: TranscriptionError };

const initialVoiceStreamState: VoiceStreamState = {
  committed: [],
  pending: "",
  closeStreamSent: false,
};

const ServerFrame = Schema.fromJsonString(
  Schema.Struct({ type: Schema.String, data: Schema.optional(Schema.String) }),
);
const decodeServerFrame = Schema.decodeUnknownOption(ServerFrame);

const transcriptOf = (state: VoiceStreamState) =>
  [...state.committed, state.pending]
    .flatMap((segment) => (segment.trim() ? [segment.trim()] : []))
    .join(" ");

const failed = (): VoiceStreamStep => ({
  _tag: "Failed",
  error: new TranscriptionError({ reason: "failed" }),
});

/**
 * `TranscriptText` replaces the segment in progress and `TranscriptEndpoint`
 * commits it. The CLI stops at the first endpoint after CloseStream, which
 * cuts recordings short, so this waits for the server to close the socket.
 */
function stepVoiceStream(state: VoiceStreamState, event: VoiceStreamEvent): VoiceStreamStep {
  switch (event._tag) {
    case "Message": {
      const frame = Option.getOrUndefined(decodeServerFrame(event.data));
      if (frame?.type === "TranscriptText") {
        return { _tag: "Continue", state: { ...state, pending: frame.data ?? "" } };
      }
      if (frame?.type === "TranscriptEndpoint") {
        return {
          _tag: "Continue",
          state: {
            ...state,
            committed: state.pending ? [...state.committed, state.pending] : state.committed,
            pending: "",
          },
        };
      }
      if (frame?.type === "TranscriptError" || frame?.type === "error") return failed();
      return { _tag: "Continue", state };
    }
    case "CloseStreamSent":
      return { _tag: "Continue", state: { ...state, closeStreamSent: true } };
    case "Closed":
      return NORMAL_CLOSE_CODES.has(event.code) && state.closeStreamSent
        ? { _tag: "Done", text: transcriptOf(state) }
        : failed();
    case "Deadline":
      return failed();
  }
}

/** Drives the session from its events; timers run on `Clock`, so tests control them. */
export const runVoiceStream = Effect.fnUntraced(function* (input: {
  readonly events: Queue.Dequeue<VoiceStreamEvent>;
  readonly audioMs: number;
}) {
  let state = initialVoiceStreamState;
  let deadlineAt: number | undefined;
  while (true) {
    const now = yield* Clock.currentTimeMillis;
    const next =
      deadlineAt === undefined
        ? Option.some(yield* Queue.take(input.events))
        : yield* Queue.take(input.events).pipe(Effect.timeoutOption(Math.max(0, deadlineAt - now)));
    const event: VoiceStreamEvent = Option.getOrElse(next, () => ({ _tag: "Deadline" }));
    if (event._tag === "CloseStreamSent") {
      deadlineAt = (yield* Clock.currentTimeMillis) + Math.max(MIN_DEADLINE_MS, input.audioMs);
    }
    const step = stepVoiceStream(state, event);
    if (step._tag === "Done") return step.text;
    if (step._tag === "Failed") return yield* step.error;
    state = step.state;
  }
});

function voiceStreamUpgradeError(
  status: number | undefined,
  headers: NodeHttp.IncomingHttpHeaders,
): TranscriptionError {
  if (headers["cf-mitigated"] !== undefined) return new TranscriptionError({ reason: "blocked" });
  if (status === 401) return new TranscriptionError({ reason: "signedOut" });
  // Not `signedOut`: a 403 can mean the account has no voice access, and a
  // sign-in prompt would loop.
  if (status === 403) return new TranscriptionError({ reason: "blocked" });
  if (status === 429) {
    const seconds = Number(headers["retry-after"]);
    return new TranscriptionError({
      reason: "rateLimited",
      ...(Number.isFinite(seconds) && seconds >= 0
        ? { retryAfterMs: Math.round(seconds * 1000) }
        : {}),
    });
  }
  return new TranscriptionError({ reason: "failed" });
}

const connect = (url: string, headers: Record<string, string>) =>
  Effect.callback<WebSocket, TranscriptionError>((resume) => {
    const socket = new WebSocket(url, { headers });
    const fail = (error: TranscriptionError) => {
      socket.removeAllListeners();
      socket.on("error", () => {});
      socket.terminate();
      resume(Effect.fail(error));
    };
    const onUpgradeRefused = (
      _request: NodeHttp.ClientRequest,
      response: NodeHttp.IncomingMessage,
    ) => {
      response.resume();
      fail(voiceStreamUpgradeError(response.statusCode, response.headers));
    };
    const onConnectError = (cause: Error) =>
      fail(new TranscriptionError({ reason: "failed", cause }));
    socket.once("unexpected-response", onUpgradeRefused);
    socket.once("error", onConnectError);
    socket.once("open", () => {
      socket.off("unexpected-response", onUpgradeRefused);
      socket.off("error", onConnectError);
      resume(Effect.succeed(socket));
    });
    return Effect.sync(() => socket.terminate());
  });

export const streamClaudeTranscription = Effect.fn("ClaudeTranscription.stream")(function* (input: {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly audio: WavAudio;
}) {
  const socket = yield* Effect.acquireRelease(
    connect(input.url, input.headers).pipe(
      Effect.timeoutOrElse({
        duration: CONNECT_TIMEOUT,
        orElse: () => Effect.fail(new TranscriptionError({ reason: "failed" })),
      }),
    ),
    (open) => Effect.sync(() => open.terminate()),
  );
  const events = yield* Queue.unbounded<VoiceStreamEvent>();
  socket.on("message", (data, isBinary) => {
    if (!isBinary) Queue.offerUnsafe(events, { _tag: "Message", data: data.toString() });
  });
  socket.on("close", (code) => Queue.offerUnsafe(events, { _tag: "Closed", code }));
  // `ws` reports protocol errors before closing; fail now rather than wait for the deadline.
  socket.on("error", () => Queue.offerUnsafe(events, { _tag: "Closed", code: 1006 }));
  const send = (data: string | Uint8Array) =>
    Effect.callback<void, TranscriptionError>((resume) => {
      socket.send(data, (cause) =>
        resume(
          cause ? Effect.fail(new TranscriptionError({ reason: "failed", cause })) : Effect.void,
        ),
      );
    });

  yield* send(KEEP_ALIVE);
  yield* Effect.forkScoped(
    send(KEEP_ALIVE).pipe(
      Effect.delay(KEEP_ALIVE_INTERVAL),
      Effect.repeat(Schedule.spaced(KEEP_ALIVE_INTERVAL)),
      Effect.ignore,
    ),
  );
  yield* Effect.forkScoped(
    Effect.gen(function* () {
      for (let offset = 0; offset < input.audio.pcm.byteLength; offset += FRAME_BYTES) {
        yield* send(input.audio.pcm.subarray(offset, offset + FRAME_BYTES));
      }
      yield* send(CLOSE_STREAM);
      Queue.offerUnsafe(events, { _tag: "CloseStreamSent" });
    }).pipe(Effect.catch(() => Queue.offer(events, { _tag: "Closed", code: 1006 }))),
  );
  return yield* runVoiceStream({ events, audioMs: input.audio.durationMs });
}, Effect.scoped);

export const makeClaudeTranscription = Effect.fn("makeClaudeTranscription")(function* (input: {
  /** The environment the instance's CLI runs with. */
  readonly environment: NodeJS.ProcessEnv;
  readonly configDir: string;
  readonly cliVersion: Effect.Effect<string | null>;
}) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const readToken = readClaudeOAuthToken({
    environment: input.environment,
    configDir: input.configDir,
  }).pipe(
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    Effect.provideService(FileSystem.FileSystem, fileSystem),
    Effect.provideService(Path.Path, path),
  );

  const transcribe: ProviderTranscription["transcribe"] = Effect.fn(
    "ClaudeTranscription.transcribe",
  )(function* ({ audio, language, keyterms }) {
    const token = yield* readToken;
    const version = (yield* input.cliVersion) ?? FALLBACK_CLI_VERSION;
    const query = new URLSearchParams({
      encoding: "linear16",
      sample_rate: "16000",
      channels: "1",
      endpointing_ms: "300",
      utterance_end_ms: "1000",
      language: language ?? "en",
      use_conversation_engine: "true",
    });
    const header = claudeKeytermsHeader(keyterms);
    const text = yield* streamClaudeTranscription({
      url: `${VOICE_STREAM_URL}?${query}`,
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": `claude-cli/${version} (external, cli)`,
        "x-app": "cli",
        "anthropic-client-platform": "claude_code_cli",
        ...(header ? { "x-config-keyterms": header } : {}),
      },
      audio,
    });
    return { text };
  });

  return {
    acceptsKeyterms: true,
    supportsLanguage: (code) => CLAUDE_VOICE_LANGUAGES.has(code),
    transcribe,
  } satisfies ProviderTranscription;
});
