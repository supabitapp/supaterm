import {
  type ServerProvider,
  type ServerProviderTranscription,
  TranscriptionError,
} from "@supaterm/contracts";
import type { ProviderTranscription, WavAudio } from "@supaterm/provider-core/server/transcription";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

const TRANSCRIBE_URL = "https://chatgpt.com/backend-api/transcribe";
// The endpoint answers only Codex Desktop's request identity.
const CODEX_DESKTOP_VERSION = "26.1021.31345";
const REQUEST_TIMEOUT = "2 minutes";
const EXPIRY_MARGIN_MS = 60_000;
const BLOCKED_STATUSES = new Set([403, 404, 405, 410]);

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

const errorCode = (body: string) =>
  Option.match(decodeErrorBody(body), {
    onNone: () => undefined,
    onSome: ({ detail, error }) =>
      [detail, error]
        .map((value) => (typeof value === "object" ? value.code : undefined))
        .find(Boolean),
  });

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
}) {
  const httpClient = yield* HttpClient.HttpClient;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const authFilePath = path.join(input.authHomePath, "auth.json");
  const refreshLock = yield* Semaphore.make(1);

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
    const claims = Option.flatMap(Option.fromNullishOr(payload), (encoded) =>
      decodeJwtClaims(Buffer.from(encoded, "base64url").toString("utf8")),
    );
    const accountId =
      auth.tokens?.account_id?.trim() ||
      Option.getOrUndefined(claims)?.["https://api.openai.com/auth"]?.chatgpt_account_id;
    if (!accountId) return yield* new TranscriptionError({ reason: "signedOut" });
    const exp = Option.getOrUndefined(claims)?.exp;
    return {
      accessToken,
      accountId,
      expiresAtMs: exp === undefined ? undefined : exp * 1000,
    } satisfies CodexLogin;
  });

  // Refresh tokens rotate, so two refreshes at once could sign the user out.
  // A caller that waited on the lock first checks whether the other already
  // refreshed.
  const refreshFrom = (stale: CodexLogin) =>
    refreshLock.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* readLogin;
        if (current.accessToken !== stale.accessToken) return current;
        yield* input.refreshLogin;
        return yield* readLogin;
      }),
    );

  const send = (login: CodexLogin, audio: WavAudio, language: string | undefined) => {
    const form = new FormData();
    form.append("file", new Blob([audio.file.slice()], { type: "audio/wav" }), "codex.wav");
    if (language !== undefined) form.append("language", language);
    return httpClient
      .execute(
        HttpClientRequest.post(TRANSCRIBE_URL).pipe(
          HttpClientRequest.setHeaders({
            authorization: `Bearer ${login.accessToken}`,
            "chatgpt-account-id": login.accountId,
            originator: "Codex Desktop",
            "user-agent": `Codex Desktop/${CODEX_DESKTOP_VERSION} (Mac OS; arm64)`,
            accept: "application/json",
          }),
          HttpClientRequest.bodyFormData(form),
        ),
      )
      .pipe(
        Effect.timeout(REQUEST_TIMEOUT),
        Effect.mapError((cause) => new TranscriptionError({ reason: "failed", cause })),
      );
  };

  const transcribe: ProviderTranscription["transcribe"] = Effect.fn(
    "CodexTranscription.transcribe",
  )(function* ({ audio, language }) {
    let login = yield* readLogin;
    const now = yield* Clock.currentTimeMillis;
    if (login.expiresAtMs !== undefined && login.expiresAtMs - EXPIRY_MARGIN_MS <= now) {
      login = yield* refreshFrom(login);
    }
    let response = yield* send(login, audio, language);
    if (response.status === 401) {
      login = yield* refreshFrom(login);
      response = yield* send(login, audio, language);
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

  return {
    acceptsKeyterms: false,
    supportsLanguage: (code) => /^[a-z]{2,3}$/.test(code),
    transcribe,
  } satisfies ProviderTranscription;
});
