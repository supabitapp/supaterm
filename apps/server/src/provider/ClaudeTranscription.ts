import * as NodeModule from "node:module";

import type { ServerProvider } from "@supaterm/contracts";
import {
  type ProviderTranscription,
  type TranscriptionClip,
  TranscriptionFailure,
  type TranscriptionFailureReason,
  type TranscriptionSourceDescription,
} from "@supaterm/provider-core/server/transcription";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Socket from "effect/socket/Socket";
import WebSocket from "ws";

import {
  ClaudeCredentials,
  claudeCliUserAgent,
  claudeCredentialsAccessToken,
  readClaudeCredentialsFileToken,
} from "./claudeResetCredits.ts";

const VOICE_STREAM_URL = "wss://api.anthropic.com/api/ws/speech_to_text/voice_stream";
const KEEP_ALIVE = '{"type":"KeepAlive"}';
const CLOSE_STREAM = '{"type":"CloseStream"}';
const SAMPLE_RATE = 16_000;
const BYTES_PER_MS = (SAMPLE_RATE * 2) / 1_000;
const FRAME_BYTES = 100 * BYTES_PER_MS;
const VOICE_LANGUAGES = new Set([
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

const OPEN_TIMEOUT = Duration.seconds(10);
const QUIET_AFTER_TRANSCRIPT = Duration.seconds(3);
const PROCESSING_ALLOWANCE_MS = 30_000;
const KEYCHAIN_CACHE_MS = 60_000;
const KEYCHAIN_TIMEOUT = Duration.seconds(30);

const KEYCHAIN_SERVICE = "Claude Code-credentials";
const KEYCHAIN_ACCOUNT = /^[a-zA-Z0-9._-]+$/;
const KEYCHAIN_FALLBACK_ACCOUNT = "claude-code-user";

const SIGNED_OUT_REASON = "Sign in to Claude Code to use voice input.";
const NOT_READY_REASON = "Claude isn't ready yet. Check it in Settings → Providers.";
const UNSUPPORTED_SIGN_IN_REASON =
  "Voice input needs Claude Code signed in with a Claude subscription. API keys and cloud providers can't transcribe.";
const KEYCHAIN_OPT_IN_REASON = "Allow Keychain access for Claude in Settings → Providers.";
const KEYCHAIN_PROMPT_REASON =
  "Allow access in the Keychain prompt on the Mac running Supaterm, then try again.";
const KEYCHAIN_UNREADABLE_REASON = "Supaterm couldn't read your Claude login from the Keychain.";

const NON_SUBSCRIPTION_AUTH_TYPES = new Set(["apiKey", "bedrock", "customEndpoint"]);

const AUTH_ERROR =
  /authenticat|unauthori[sz]ed|permission|forbidden|invalid[\s_-]?token|token[\s_-]?expired|oauth/i;
const RATE_LIMIT_ERROR = /rate[\s_-]?limit|too[\s_-]?many[\s_-]?requests/i;

export class ClaudeKeychainReadError extends Schema.TaggedError<ClaudeKeychainReadError>()(
  "ClaudeKeychainReadError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Claude Keychain credentials could not be read.";
  }
}

export type ClaudeKeychainRead = (
  service: string,
  account: string,
) => Effect.Effect<string | null, ClaudeKeychainReadError>;

export interface ClaudeVoiceUpgradeRejection {
  readonly status: number;
  readonly retryAfter: string | undefined;
  readonly challenged: boolean;
}

export type ClaudeVoiceSocketFactory = (request: {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly onUpgradeRejected: (rejection: ClaudeVoiceUpgradeRejection) => void;
}) => Socket.WebSocketLike;

const requireForKeyring = NodeModule.createRequire(import.meta.url);

const readKeychainPassword: ClaudeKeychainRead = (service, account) =>
  Effect.tryPromise({
    try: async () => {
      const { AsyncEntry } = requireForKeyring(
        "@napi-rs/keyring",
      ) as typeof import("@napi-rs/keyring");
      return (await new AsyncEntry(service, account).getPassword()) ?? null;
    },
    catch: (cause) => new ClaudeKeychainReadError({ cause }),
  });

const openVoiceSocket: ClaudeVoiceSocketFactory = ({ url, headers, onUpgradeRejected }) => {
  const socket = new WebSocket(url, { headers });
  // With a listener attached, ws leaves a refused upgrade pending; ending it
  // reports the refusal through the usual error and close events.
  socket.on("unexpected-response", (_request, response) => {
    onUpgradeRejected({
      status: response.statusCode ?? 0,
      retryAfter: response.headers["retry-after"],
      challenged: response.headers["cf-mitigated"] !== undefined,
    });
    response.resume();
    socket.terminate();
  });
  return socket;
};

const failure = (reason: TranscriptionFailureReason) => new TranscriptionFailure({ reason });

const upstream = (
  category: "network" | "timeout" | "server" | "bad-response",
  status: number | null = null,
) => failure({ _tag: "upstream", category, status });

const isAuthFailure = (error: TranscriptionFailure) => error.reason._tag === "auth";

const retryAfterSeconds = (value: string | undefined) =>
  value !== undefined && /^\d{1,6}$/.test(value.trim()) ? Number(value.trim()) : null;

const voiceLanguage = (language: string | undefined) => {
  const normalized = language?.trim().toLowerCase() ?? "";
  if (VOICE_LANGUAGES.has(normalized)) return normalized;
  const primary = normalized.split(/[-_]/)[0] ?? "";
  return VOICE_LANGUAGES.has(primary) ? primary : "en";
};

const ascii = (bytes: Uint8Array, offset: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + 4));

const wavPcm16Mono = (bytes: Uint8Array): Uint8Array | undefined => {
  if (bytes.byteLength < 12 || ascii(bytes, 0) !== "RIFF" || ascii(bytes, 8) !== "WAVE") return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pcm = false;
  let data: Uint8Array | undefined;
  for (let offset = 12; offset + 8 <= bytes.byteLength;) {
    const id = ascii(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      if (size < 16 || body + 16 > bytes.byteLength) return;
      pcm =
        view.getUint16(body, true) === 1 &&
        view.getUint16(body + 2, true) === 1 &&
        view.getUint32(body + 4, true) === SAMPLE_RATE &&
        view.getUint16(body + 14, true) === 16;
    } else if (id === "data") {
      const end = Math.min(body + size, bytes.byteLength);
      data = bytes.subarray(body, end - ((end - body) % 2));
    }
    offset = body + size + (size % 2);
  }
  return pcm && data !== undefined && data.byteLength > 0 ? data : undefined;
};

const audioFrames = (pcm: Uint8Array) => {
  const frames: Array<Uint8Array> = [];
  for (let offset = 0; offset < pcm.byteLength; offset += FRAME_BYTES) {
    frames.push(pcm.subarray(offset, offset + FRAME_BYTES));
  }
  return frames;
};

const VoiceFrameEnvelope = Schema.fromJsonString(Schema.Struct({ type: Schema.String }));
const VoiceFrameType = Schema.Literals([
  "TranscriptText",
  "TranscriptInterim",
  "TranscriptEndpoint",
  "TranscriptError",
  "error",
]);
const OptionalText = Schema.optional(Schema.NullOr(Schema.String));
const VoiceFrame = Schema.fromJsonString(
  Schema.Struct({
    type: VoiceFrameType,
    data: OptionalText,
    error_code: OptionalText,
    description: OptionalText,
    message: OptionalText,
  }),
);
const decodeVoiceFrameEnvelope = Schema.decodeUnknownOption(VoiceFrameEnvelope);
const decodeVoiceFrame = Schema.decodeUnknownOption(VoiceFrame);
const isVoiceFrameType = Schema.is(VoiceFrameType);
const decodeCredentialsJson = Schema.decodeUnknownOption(Schema.fromJsonString(ClaudeCredentials));
const textDecoder = new TextDecoder();

const errorFrameFailure = (detail: string) =>
  AUTH_ERROR.test(detail)
    ? failure({ _tag: "auth" })
    : RATE_LIMIT_ERROR.test(detail)
      ? failure({ _tag: "rateLimited", retryAfterSeconds: null })
      : upstream("server");

const rejectionFailure = ({ status, retryAfter, challenged }: ClaudeVoiceUpgradeRejection) => {
  if (challenged) return failure({ _tag: "endpointRejected" });
  if (status === 401 || status === 403) return failure({ _tag: "auth" });
  if (status === 429)
    return failure({ _tag: "rateLimited", retryAfterSeconds: retryAfterSeconds(retryAfter) });
  if (status === 408) return upstream("timeout", status);
  if (status >= 500) return upstream("server", status);
  return upstream("bad-response", status);
};

const closeFailure = (error: Socket.SocketError) => {
  const { reason } = error;
  if (reason._tag !== "SocketCloseError") return upstream("network");
  if (reason.closeReason !== undefined && AUTH_ERROR.test(reason.closeReason))
    return failure({ _tag: "auth" });
  return reason.code === 1006 ? upstream("network") : upstream("server");
};

const isNormalClose = (error: Socket.SocketError) =>
  error.reason._tag === "SocketCloseError" &&
  (error.reason.code === 1000 || error.reason.code === 1005);

/**
 * Follows the CLI's transcript model: each `TranscriptText` replaces the
 * in-progress segment, `TranscriptEndpoint` commits it, and a segment still
 * pending when the stream ends is kept. The CLI finishes on the first
 * endpoint after `CloseStream`, but it sends `CloseStream` after streaming in
 * real time; a recorded clip sends it straight after the audio, so every
 * pause in the clip ends in an endpoint after it. The stream therefore ends
 * when the server closes it, or goes quiet once it has started answering;
 * audio still in flight can delay the first answer, so silence before it is
 * left to the overall deadline rather than read as an empty transcript.
 */
const collectTranscript = Effect.fn("ClaudeTranscription.collectTranscript")(function* (
  pull: Socket.Reader["pull"],
) {
  const finals: Array<string> = [];
  let pending = "";
  let answering = false;
  const commit = () => {
    const text = pending.trim();
    pending = "";
    if (text) finals.push(text);
  };
  while (true) {
    const frames = yield* (
      answering ? pull.pipe(Effect.timeoutOption(QUIET_AFTER_TRANSCRIPT)) : Effect.asSome(pull)
    ).pipe(
      Effect.catchTags({
        SocketError: (error) =>
          isNormalClose(error) ? Effect.succeedNone : Effect.fail(closeFailure(error)),
      }),
    );
    if (Option.isNone(frames)) break;
    for (const raw of frames.value) {
      const text = typeof raw === "string" ? raw : textDecoder.decode(raw);
      const envelope = decodeVoiceFrameEnvelope(text);
      if (Option.isNone(envelope)) return yield* upstream("bad-response");
      if (!isVoiceFrameType(envelope.value.type)) continue;
      const frame = decodeVoiceFrame(text);
      if (Option.isNone(frame)) return yield* upstream("bad-response");
      const { type, data, error_code, description, message } = frame.value;
      if (type === "TranscriptText" || type === "TranscriptInterim") {
        answering = true;
        if (data) pending = data;
      } else if (type === "TranscriptEndpoint") {
        answering = true;
        commit();
      } else {
        yield* Effect.logWarning("Claude voice stream reported an error.", { frame: type });
        return yield* errorFrameFailure([error_code, description, message].join(" "));
      }
    }
  }
  commit();
  return { text: finals.join(" ") };
});

const makeKeychainLogin = (read: Effect.Effect<string | null, ClaudeKeychainReadError>) => {
  let cached: { readonly token: string; readonly untilMs: number } | null = null;
  let pending: Deferred.Deferred<string | null, ClaudeKeychainReadError> | null = null;

  // The macOS prompt shows on the server's own screen, so a read outlives the
  // request that started it and the next request joins it instead of stacking
  // a second prompt.
  const startRead = Effect.uninterruptible(
    Effect.gen(function* () {
      if (pending !== null) return pending;
      const done = Deferred.makeUnsafe<string | null, ClaudeKeychainReadError>();
      pending = done;
      yield* read.pipe(
        Effect.tap((token) =>
          Clock.currentTimeMillis.pipe(
            Effect.map((nowMs) => {
              cached = token ? { token, untilMs: nowMs + KEYCHAIN_CACHE_MS } : null;
            }),
          ),
        ),
        Effect.onExit((exit) =>
          Effect.suspend(() => {
            pending = null;
            return Deferred.done(done, exit);
          }),
        ),
        Effect.forkDetach,
      );
      return done;
    }),
  );

  const token = Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    if (cached !== null && cached.untilMs > nowMs) return cached.token;
    const done = yield* startRead;
    const result = yield* Deferred.await(done).pipe(
      Effect.timeoutOption(KEYCHAIN_TIMEOUT),
      Effect.mapError(() => failure({ _tag: "ineligible", reason: KEYCHAIN_UNREADABLE_REASON })),
    );
    if (Option.isNone(result))
      return yield* failure({ _tag: "ineligible", reason: KEYCHAIN_PROMPT_REASON });
    return result.value;
  });

  const forget = Effect.sync(() => {
    cached = null;
  });

  return { token, forget };
};

const claudeKeychainService = Effect.fn("claudeKeychainService")(function* (
  environment: NodeJS.ProcessEnv,
) {
  const configDir = environment.CLAUDE_CONFIG_DIR;
  if (!configDir) return KEYCHAIN_SERVICE;
  const digest = yield* (yield* Crypto.Crypto)
    .digest("SHA-256", new TextEncoder().encode(configDir.normalize("NFC")))
    .pipe(Effect.orDie);
  return `${KEYCHAIN_SERVICE}-${Hex.encode(digest).slice(0, 8)}`;
});

const claudeKeychainAccount = (user: string | undefined, username: string | null) => {
  const account = user || username || "";
  return KEYCHAIN_ACCOUNT.test(account) ? account : KEYCHAIN_FALLBACK_ACCOUNT;
};

const accountUnavailableReason = ({ auth }: ServerProvider) => {
  if (auth.status === "unauthenticated") return SIGNED_OUT_REASON;
  if (auth.status !== "authenticated") return NOT_READY_REASON;
  if (auth.type === undefined || NON_SUBSCRIPTION_AUTH_TYPES.has(auth.type))
    return UNSUPPORTED_SIGN_IN_REASON;
  return undefined;
};

const describeSource = (
  provider: ServerProvider,
  unavailableReason: string | undefined,
): TranscriptionSourceDescription => ({
  serviceLabel: "Claude",
  accountLabel: provider.auth.email ?? null,
  eligible: unavailableReason === undefined,
  ...(unavailableReason === undefined ? {} : { unavailableReason }),
  audioFormats: unavailableReason === undefined ? ["wav"] : [],
});

export const makeClaudeTranscription = Effect.fn("makeClaudeTranscription")(function* (
  input: {
    readonly account: Effect.Effect<ServerProvider>;
    readonly configDir: string;
    readonly environment: NodeJS.ProcessEnv;
    readonly keychainUsageEnabled: Effect.Effect<boolean>;
  },
  options: {
    readonly openSocket?: ClaudeVoiceSocketFactory;
    readonly readKeychain?: ClaudeKeychainRead;
  } = {},
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcess.Platform;
  const openSocket = options.openSocket ?? openVoiceSocket;
  const keychainService = yield* claudeKeychainService(input.environment);
  const keychainAccount = claudeKeychainAccount(
    input.environment.USER,
    yield* HostProcess.Username,
  );
  const keychain = makeKeychainLogin(
    (options.readKeychain ?? readKeychainPassword)(keychainService, keychainAccount).pipe(
      Effect.map((json) =>
        json === null
          ? null
          : Option.match(decodeCredentialsJson(json), {
              onNone: () => null,
              onSome: (credentials) => claudeCredentialsAccessToken(credentials) ?? null,
            }),
      ),
    ),
  );

  const readFileToken = readClaudeCredentialsFileToken(input.configDir).pipe(
    Effect.provideService(FileSystem.FileSystem, fileSystem),
    Effect.provideService(Path.Path, path),
    Effect.orElseSucceed(() => undefined),
  );

  const keychainAllowed =
    platform === "darwin" ? input.keychainUsageEnabled : Effect.succeed(false);

  const readClipAudio = (filePath: string) =>
    fileSystem.readFile(filePath).pipe(
      Effect.mapError(() => failure({ _tag: "invalidAudio" })),
      Effect.flatMap((bytes) => {
        const pcm = wavPcm16Mono(bytes);
        return pcm === undefined
          ? Effect.fail(failure({ _tag: "invalidAudio" }))
          : Effect.succeed(pcm);
      }),
    );

  const stream = Effect.fn("ClaudeTranscription.stream")(
    function* (request: {
      readonly token: string;
      readonly version: string;
      readonly audio: Uint8Array;
      readonly language: string;
    }) {
      let rejection: ClaudeVoiceUpgradeRejection | undefined;
      const params = new URLSearchParams({
        encoding: "linear16",
        sample_rate: String(SAMPLE_RATE),
        channels: "1",
        endpointing_ms: "300",
        utterance_end_ms: "1000",
        language: request.language,
        use_conversation_engine: "true",
      });
      const socket = yield* Socket.fromWebSocket(
        Effect.acquireRelease(
          Effect.try({
            try: () =>
              openSocket({
                url: `${VOICE_STREAM_URL}?${params}`,
                headers: {
                  authorization: `Bearer ${request.token}`,
                  "user-agent": claudeCliUserAgent(request.version),
                  "x-app": "cli",
                  "anthropic-client-platform": "claude_code_cli",
                },
                onUpgradeRejected: (value) => {
                  rejection = value;
                },
              }),
            catch: (cause) =>
              new Socket.SocketError({
                reason: new Socket.SocketOpenError({ kind: "Unknown", cause }),
              }),
          }),
          (webSocket) => Effect.sync(() => webSocket.close(1000)),
        ),
        { openTimeout: OPEN_TIMEOUT },
      );
      const reader = yield* socket.reader.pipe(
        Effect.mapError((error) => {
          if (rejection !== undefined) return rejectionFailure(rejection);
          return error.reason._tag === "SocketOpenError" && error.reason.kind === "Timeout"
            ? upstream("timeout")
            : upstream("network");
        }),
      );
      const writer = yield* socket.writer;
      yield* writer
        .writeAll([KEEP_ALIVE, ...audioFrames(request.audio), CLOSE_STREAM])
        .pipe(Effect.mapError(() => upstream("network")));
      const transcript = yield* collectTranscript(reader.pull).pipe(
        Effect.timeoutOption(
          Duration.millis(request.audio.byteLength / BYTES_PER_MS + PROCESSING_ALLOWANCE_MS),
        ),
      );
      if (Option.isNone(transcript)) return yield* upstream("timeout");
      return transcript.value;
    },
    Effect.scoped,
    Effect.tapError((error) =>
      Effect.logWarning("Claude voice stream failed.", {
        reason: error.reason._tag,
        status: error.reason._tag === "upstream" ? error.reason.status : null,
      }),
    ),
  );

  const transcribe = Effect.fn("ClaudeTranscription.transcribe")(function* (
    clip: TranscriptionClip,
  ) {
    const provider = yield* input.account;
    const unavailableReason = accountUnavailableReason(provider);
    if (unavailableReason !== undefined)
      return yield* failure({ _tag: "ineligible", reason: unavailableReason });
    const version = provider.version;
    if (version === null) return yield* failure({ _tag: "ineligible", reason: NOT_READY_REASON });
    const audio = yield* readClipAudio(clip.filePath);
    const language = voiceLanguage(clip.language);
    const send = (token: string) => stream({ token, version, audio, language });

    if (platform === "darwin") {
      if (!(yield* keychainAllowed))
        return yield* failure({ _tag: "ineligible", reason: KEYCHAIN_OPT_IN_REASON });
      // Like the CLI, the Keychain login wins: the plaintext fallback file can
      // outlive a newer Keychain login for a different account.
      const keychainToken = yield* keychain.token;
      if (keychainToken !== null) {
        return yield* send(keychainToken).pipe(
          Effect.tapError((error) => (isAuthFailure(error) ? keychain.forget : Effect.void)),
        );
      }
    }
    const fileToken = yield* readFileToken;
    if (fileToken === undefined) return yield* failure({ _tag: "auth" });
    return yield* send(fileToken);
  });

  const describe = Effect.gen(function* () {
    const provider = yield* input.account;
    if (!provider.enabled) return null;
    const unavailableReason = accountUnavailableReason(provider);
    if (unavailableReason !== undefined) return describeSource(provider, unavailableReason);
    if (platform === "darwin") {
      return describeSource(
        provider,
        (yield* keychainAllowed) ? undefined : KEYCHAIN_OPT_IN_REASON,
      );
    }
    return describeSource(
      provider,
      (yield* readFileToken) === undefined ? SIGNED_OUT_REASON : undefined,
    );
  });

  return { kind: "claude", describe, transcribe } satisfies ProviderTranscription;
});
