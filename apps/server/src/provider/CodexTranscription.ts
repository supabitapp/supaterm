import {
  type ServerProvider,
  type ServerProviderTranscription,
  TranscriptionError,
} from "@supaterm/contracts";
import {
  LiveTranscriptionUnavailable,
  type ProviderTranscription,
} from "@supaterm/provider-core/server/transcription";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import {
  ACCEPT_LANGUAGE,
  CODEX_DICTATION_STREAM_URL,
  codexDictationHeaders,
  streamCodexDictation,
} from "./CodexDictationStream.ts";

const TRANSCRIBE_URL = "https://chatgpt.com/backend-api/transcribe";
// The endpoint answers only Codex Desktop's request identity.
const CODEX_DESKTOP_VERSION = "26.1027.61615";
const REQUEST_TIMEOUT = "2 minutes";
const EXPIRY_MARGIN_MS = 60_000;
const BLOCKED_STATUSES = new Set([403, 404, 405, 410]);
const CODEX_DESKTOP_USER_AGENT = `Codex Desktop/${CODEX_DESKTOP_VERSION} (Mac OS; arm64)`;
// Streaming is rolled out per account, so a refusal holds for a while instead of every recording.
const STREAMING_REFUSAL_MS = 60 * 60_000;

const AuthFile = Schema.fromJsonString(
  Schema.Struct({
    tokens: Schema.optional(
      Schema.NullOr(
        Schema.Struct({
          access_token: Schema.optional(Schema.NullOr(Schema.String)),
          account_id: Schema.optional(Schema.NullOr(Schema.String)),
        }),
      ),
    ),
  }),
);
const decodeAuthFile = Schema.decodeUnknownEffect(AuthFile);

const JwtClaims = Schema.fromJsonString(
  Schema.Struct({
    exp: Schema.optional(Schema.Number),
    "https://api.openai.com/auth": Schema.optional(
      Schema.Struct({ chatgpt_account_id: Schema.optional(Schema.String) }),
    ),
  }),
);
const decodeJwtClaims = Schema.decodeUnknownOption(JwtClaims);

const TranscribeResponse = Schema.Struct({ text: Schema.String });

const ErrorCode = Schema.Struct({ code: Schema.optional(Schema.String) });
const ErrorBody = Schema.fromJsonString(
  Schema.Struct({
    detail: Schema.optional(Schema.Union([ErrorCode, Schema.String])),
    error: Schema.optional(Schema.Union([ErrorCode, Schema.String])),
  }),
);
const decodeErrorBody = Schema.decodeUnknownOption(ErrorBody);

interface CodexLogin {
  readonly accessToken: string;
  readonly accountId: string;
  readonly expiresAtMs: number | undefined;
}

const errorCode = (body: string) => {
  const parsed = Option.getOrUndefined(decodeErrorBody(body));
  return [parsed?.detail, parsed?.error]
    .map((value) => (typeof value === "object" ? value.code : undefined))
    .find(Boolean);
};

const retryAfterMs = (header: string | undefined) => {
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : undefined;
};

const statusError = (status: number, code: string | undefined, retryAfter: string | undefined) => {
  if (status === 429) {
    const retry = retryAfterMs(retryAfter);
    return new TranscriptionError({
      reason: "rateLimited",
      ...(retry === undefined ? {} : { retryAfterMs: retry }),
    });
  }
  if (code === "audio_too_short") return new TranscriptionError({ reason: "audioTooShort" });
  if (status === 413 || code === "file_above_max_size") {
    return new TranscriptionError({ reason: "audioTooLong" });
  }
  if (status === 400 || status === 415 || status === 422) {
    return new TranscriptionError({ reason: "invalidAudio" });
  }
  if (status === 401) return new TranscriptionError({ reason: "signedOut" });
  if (BLOCKED_STATUSES.has(status)) return new TranscriptionError({ reason: "blocked" });
  return new TranscriptionError({ reason: "failed" });
};

/** The desktop composer's upload, byte for byte: its boundary, part order, and part headers. */
const transcribeBody = (wav: Uint8Array, language: string | undefined, uuid: string) => {
  const boundary = `----codex-transcribe-${uuid}`;
  const languagePart =
    language === undefined
      ? ""
      : `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${language}\r\n`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="codex.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
    ),
    wav,
    Buffer.from(`\r\n${languagePart}--${boundary}--\r\n`),
  ]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
};

/** Status from the provider check. Credentials are only checked for presence, never read. */
export const codexTranscriptionStatus = (
  auth: ServerProvider["auth"],
  authFileExists: boolean,
): ServerProviderTranscription | undefined => {
  if (auth.status === "unauthenticated") return { status: "unavailable", reason: "signedOut" };
  if (auth.status !== "authenticated") return undefined;
  // A keyring or auto credential store leaves no auth.json to read.
  return auth.type === "chatgpt" && authFileExists
    ? { status: "ready" }
    : { status: "unavailable", reason: "unsupportedLogin" };
};

export const makeCodexTranscription = Effect.fn("makeCodexTranscription")(function* (input: {
  readonly authHomePath: string;
  /** Asks the CLI's app-server to refresh the ChatGPT login it owns. */
  readonly refreshLogin: Effect.Effect<void, TranscriptionError>;
  /**
   * Holds the login's lock, shared by every instance that reads this
   * auth.json: refresh tokens rotate, so two refreshes at once could sign the
   * user out.
   */
  readonly withLoginLock: <A>(
    effect: Effect.Effect<A, TranscriptionError>,
  ) => Effect.Effect<A, TranscriptionError>;
}) {
  const httpClient = yield* HttpClient.HttpClient;
  const crypto = yield* Crypto.Crypto;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const authFilePath = path.join(input.authHomePath, "auth.json");

  const readLogin = Effect.gen(function* () {
    const contents = yield* fileSystem.readFileString(authFilePath).pipe(
      Effect.catchTags({
        PlatformError: (cause) =>
          Effect.fail(
            new TranscriptionError({
              reason: cause.reason._tag === "NotFound" ? "unsupportedLogin" : "failed",
              cause,
            }),
          ),
      }),
    );
    const auth = yield* decodeAuthFile(contents).pipe(
      Effect.mapError((cause) => new TranscriptionError({ reason: "signedOut", cause })),
    );
    const accessToken = auth.tokens?.access_token?.trim();
    if (!accessToken) return yield* new TranscriptionError({ reason: "signedOut" });
    const payload = accessToken.split(".")[1];
    const claims = Option.getOrUndefined(
      Option.flatMap(Option.fromNullishOr(payload), (encoded) =>
        decodeJwtClaims(Buffer.from(encoded, "base64url").toString("utf8")),
      ),
    );
    const accountId =
      auth.tokens?.account_id?.trim() ||
      claims?.["https://api.openai.com/auth"]?.chatgpt_account_id;
    if (!accountId) return yield* new TranscriptionError({ reason: "signedOut" });
    return {
      accessToken,
      accountId,
      expiresAtMs: claims?.exp === undefined ? undefined : claims.exp * 1000,
    } satisfies CodexLogin;
  });

  // A caller that waited on the lock first checks whether another already refreshed.
  const refreshFrom = (stale: CodexLogin) =>
    input.withLoginLock(
      Effect.gen(function* () {
        const current = yield* readLogin;
        if (current.accessToken !== stale.accessToken) return current;
        yield* input.refreshLogin;
        return yield* readLogin;
      }),
    );

  const send = (login: CodexLogin, { body, contentType }: ReturnType<typeof transcribeBody>) =>
    httpClient
      .execute(
        HttpClientRequest.post(TRANSCRIBE_URL).pipe(
          HttpClientRequest.setHeaders({
            authorization: `Bearer ${login.accessToken}`,
            "chatgpt-account-id": login.accountId,
            originator: "Codex Desktop",
            "user-agent": CODEX_DESKTOP_USER_AGENT,
            "accept-language": ACCEPT_LANGUAGE,
          }),
          HttpClientRequest.bodyUint8Array(body, contentType),
        ),
      )
      .pipe(
        // Trace headers would carry our span ids to the vendor; the desktop app sends none.
        Effect.provideService(HttpClient.TracerPropagationEnabled, false),
        Effect.timeout(REQUEST_TIMEOUT),
        Effect.mapError((cause) => new TranscriptionError({ reason: "failed", cause })),
      );

  const freshLogin = Effect.gen(function* () {
    const login = yield* readLogin;
    const now = yield* Clock.currentTimeMillis;
    return login.expiresAtMs !== undefined && login.expiresAtMs - EXPIRY_MARGIN_MS <= now
      ? yield* refreshFrom(login)
      : login;
  });

  const transcribe: ProviderTranscription["transcribe"] = Effect.fn(
    "CodexTranscription.transcribe",
  )(function* ({ audio, language }) {
    const uuid = yield* crypto
      .randomUUIDv4()
      .pipe(Effect.mapError((cause) => new TranscriptionError({ reason: "failed", cause })));
    const upload = transcribeBody(audio.file, language, uuid);
    let login = yield* freshLogin;
    let response = yield* send(login, upload);
    if (response.status === 401) {
      login = yield* refreshFrom(login);
      response = yield* send(login, upload);
    }
    if (response.headers["cf-mitigated"] !== undefined) {
      return yield* new TranscriptionError({ reason: "blocked" });
    }
    if (response.status !== 200) {
      const body = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
      return yield* statusError(response.status, errorCode(body), response.headers["retry-after"]);
    }
    const { text } = yield* HttpClientResponse.schemaBodyJson(TranscribeResponse)(response).pipe(
      Effect.mapError((cause) => new TranscriptionError({ reason: "failed", cause })),
    );
    return { text: text.trim() };
  });

  let streamingRefusedUntil = 0;
  const stream: NonNullable<ProviderTranscription["stream"]> = Effect.fn(
    "CodexTranscription.stream",
  )(function* ({ audio, language }) {
    if ((yield* Clock.currentTimeMillis) < streamingRefusedUntil) {
      return yield* new LiveTranscriptionUnavailable({
        cause: new TranscriptionError({ reason: "blocked" }),
      });
    }
    const text = yield* streamCodexDictation({
      url: CODEX_DICTATION_STREAM_URL,
      headers: (refresh) => {
        const login = refresh ? Effect.flatMap(readLogin, refreshFrom) : freshLogin;
        return Effect.map(login, (current) =>
          codexDictationHeaders(current, CODEX_DESKTOP_USER_AGENT),
        );
      },
      language,
      audio,
    }).pipe(
      Effect.tapError((error) =>
        error._tag === "LiveTranscriptionUnavailable" && error.cause.reason === "blocked"
          ? Effect.map(Clock.currentTimeMillis, (now) => {
              streamingRefusedUntil = now + STREAMING_REFUSAL_MS;
            })
          : Effect.void,
      ),
    );
    return { text: text.trim() };
  });

  return {
    acceptsKeyterms: false,
    supportsLanguage: (code) => /^[a-z]{2,3}$/.test(code),
    transcribe,
    stream,
  } satisfies ProviderTranscription;
});
