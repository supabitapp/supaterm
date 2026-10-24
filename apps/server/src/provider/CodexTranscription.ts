import type { ServerProvider } from "@supaterm/contracts";
import {
  type ProviderTranscription,
  TranscriptionFailure,
  type TranscriptionFailureReason,
  type TranscriptionSourceDescription,
} from "@supaterm/provider-core/server/transcription";
import * as Clock from "effect/Clock";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import type * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import type { ChildProcessSpawner } from "effect/process";
import type * as CodexErrors from "effect-codex-app-server/errors";

import packageJson from "../../package.json" with { type: "json" };
import { CODEX_CLIENT_NAME, withCodexAppServerClient } from "./CodexProvider.ts";

const OPENAI_TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";
const OPENAI_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";

const CHATGPT_TRANSCRIBE_URL = "https://chatgpt.com/backend-api/transcribe";

const ATTEMPT_TIMEOUT = Duration.seconds(60);
const AUTH_STATUS_TIMEOUT = Duration.seconds(20);
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 2_000;
const RETRY_BUDGET_MS = 10_000;
const REJECTED_COOLDOWN_MS = 15 * 60_000;

const UNSUPPORTED_SIGN_IN_REASON =
  "This sign-in method can't transcribe. Add a Codex account signed in with the Codex CLI or an OpenAI API key.";
const SIGNED_OUT_REASON = "Sign in to Codex to transcribe.";
const NOT_READY_REASON = "Codex isn't ready yet. Check it in Settings → Providers.";
const UNREACHABLE_REASON = "Codex couldn't be started to read its sign-in.";

interface CodexTranscriptionEndpoint {
  readonly name: "openai-api" | "chatgpt";
  readonly url: string;
  readonly serviceLabel: string;
  readonly audioFormats: ReadonlyArray<string>;
  readonly fields: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string>>;
}

const OPENAI_API_ENDPOINT: CodexTranscriptionEndpoint = {
  name: "openai-api",
  url: OPENAI_TRANSCRIPTIONS_URL,
  serviceLabel: "OpenAI API",
  audioFormats: ["webm", "ogg", "mp4", "m4a", "wav"],
  fields: { model: OPENAI_TRANSCRIPTION_MODEL },
  headers: {},
};

const CHATGPT_ENDPOINT: CodexTranscriptionEndpoint = {
  name: "chatgpt",
  url: CHATGPT_TRANSCRIBE_URL,
  serviceLabel: "ChatGPT",

  audioFormats: ["webm", "wav"],
  fields: {},
  headers: {
    originator: "Codex Desktop",
    "user-agent": "Codex Desktop/26.1007.71326 (Mac OS; arm64)",
  },
};

interface CodexAppServerLaunch {
  readonly binaryPath: string;
  readonly homePath?: string | undefined;
  readonly launchArgs?: string | undefined;
  readonly environment?: NodeJS.ProcessEnv | undefined;
}

export interface CodexAuthStatus {
  readonly authMethod: unknown;
  readonly authToken: string | null;

  readonly userAgent: string;
}

export type CodexAuthStatusProbe = (
  input: CodexAppServerLaunch & { readonly refreshToken: boolean },
) => Effect.Effect<
  CodexAuthStatus,
  CodexErrors.CodexAppServerError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path | Scope.Scope
>;

const probeCodexAuthStatus: CodexAuthStatusProbe = Effect.fnUntraced(function* (input) {
  const { client, initialize } = yield* withCodexAppServerClient({ ...input, cwd: process.cwd() });
  const status = yield* client.request("getAuthStatus", {
    includeToken: true,
    refreshToken: input.refreshToken,
  });
  return {
    authMethod: status.authMethod,
    authToken: status.authToken,
    userAgent: initialize.userAgent,
  };
});

interface CodexCredentials {
  readonly endpoint: CodexTranscriptionEndpoint;
  readonly token: Redacted.Redacted<string>;
  readonly accountId: string | null;
  readonly userAgent: string;
}

class CredentialsRejected extends Data.TaggedError("CredentialsRejected")<{
  readonly endpoint: CodexTranscriptionEndpoint["name"];
}> {}

const failure = (reason: TranscriptionFailureReason) => new TranscriptionFailure({ reason });

const decodeAuthMethod = Schema.decodeUnknownOption(Schema.Literals(["apikey", "chatgpt"]));

const decodeChatGptAccessTokenClaims = Schema.decodeUnknownOption(
  Schema.StringFromBase64Url.pipe(
    Schema.decodeTo(
      Schema.fromJsonString(
        Schema.Struct({
          "https://api.openai.com/auth": Schema.Struct({
            chatgpt_account_id: Schema.NonEmptyString,
          }),
        }),
      ),
    ),
  ),
);

const chatGptAccountIdFromAccessToken = (token: string): string | null =>
  Option.match(decodeChatGptAccessTokenClaims(token.split(".")[1] ?? ""), {
    onNone: () => null,
    onSome: (claims) => claims["https://api.openai.com/auth"].chatgpt_account_id,
  });

const honestUserAgent = (reported: string) =>
  reported.startsWith(`${CODEX_CLIENT_NAME}/`)
    ? reported
    : `${CODEX_CLIENT_NAME}/${packageJson.version}`;

const languageCode = (language: string | undefined) => {
  const primary = language?.split(/[-_]/)[0]?.toLowerCase();
  return primary !== undefined && /^[a-z]{2,3}$/.test(primary) ? primary : undefined;
};

const retryAfterSeconds = (value: string | undefined) =>
  value !== undefined && /^\d{1,6}$/.test(value.trim()) ? Number(value.trim()) : null;

const isRetryable = (error: TranscriptionFailure | CredentialsRejected) =>
  error._tag === "TranscriptionFailure" &&
  error.reason._tag === "upstream" &&
  (error.reason.category === "network" ||
    error.reason.category === "timeout" ||
    error.reason.category === "server" ||
    error.reason.status === 408);

const withRetries = <A>(
  attempt: Effect.Effect<A, TranscriptionFailure | CredentialsRejected>,
): Effect.Effect<A, TranscriptionFailure | CredentialsRejected> => {
  const run = (
    attemptNumber: number,
    spentMs: number,
  ): Effect.Effect<A, TranscriptionFailure | CredentialsRejected> =>
    attempt.pipe(
      Effect.catch((error) => {
        const delayMs = RETRY_BASE_DELAY_MS * 2 ** (attemptNumber - 1);
        return isRetryable(error) &&
          attemptNumber < MAX_ATTEMPTS &&
          spentMs + delayMs <= RETRY_BUDGET_MS
          ? Effect.sleep(Duration.millis(delayMs)).pipe(
              Effect.andThen(run(attemptNumber + 1, spentMs + delayMs)),
            )
          : Effect.fail(error);
      }),
    );
  return run(1, 0);
};

const ineligible = (serviceLabel: string, reason: string): TranscriptionSourceDescription => ({
  serviceLabel,
  accountLabel: null,
  eligible: false,
  unavailableReason: reason,
  audioFormats: [],
});

function describeCodexAccount(
  provider: ServerProvider,
  rejected: boolean,
): TranscriptionSourceDescription | null {
  if (!provider.enabled) return null;
  const { auth } = provider;
  if (auth.status === "unauthenticated") return ineligible("Codex", SIGNED_OUT_REASON);
  if (auth.status !== "authenticated") return ineligible("Codex", NOT_READY_REASON);
  const endpoint =
    auth.type === "apiKey"
      ? OPENAI_API_ENDPOINT
      : auth.type === "chatgpt"
        ? CHATGPT_ENDPOINT
        : null;
  if (endpoint === null) return ineligible("Codex", UNSUPPORTED_SIGN_IN_REASON);
  return {
    serviceLabel: endpoint.serviceLabel,
    accountLabel: endpoint === CHATGPT_ENDPOINT ? (auth.email ?? null) : null,
    eligible: !rejected,
    ...(rejected
      ? {
          unavailableReason: `${endpoint.serviceLabel} turned down the last transcription request. Try again later.`,
        }
      : {}),
    audioFormats: endpoint.audioFormats,
  };
}

export const makeCodexTranscription = Effect.fn("makeCodexTranscription")(function* (
  input: {
    readonly account: Effect.Effect<ServerProvider>;
    readonly launch: CodexAppServerLaunch;
  },
  probe: CodexAuthStatusProbe = probeCodexAuthStatus,
) {
  const http = yield* HttpClient.HttpClient;
  const fileSystem = yield* FileSystem.FileSystem;
  const probeContext = yield* Effect.context<
    ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
  >();
  const credentialsLock = yield* Semaphore.make(1);
  const rejectedUntilMs = yield* Ref.make<number | null>(null);

  const readCredentials = Effect.fnUntraced(function* (refreshToken: boolean) {
    const status = yield* probe({ ...input.launch, refreshToken }).pipe(
      Effect.scoped,
      Effect.timeoutOption(AUTH_STATUS_TIMEOUT),
      Effect.provideContext(probeContext),
      Effect.tapError((error) =>
        Effect.logWarning("Codex sign-in could not be read for transcription.", {
          error: error._tag,
        }),
      ),
      Effect.mapError(() => failure({ _tag: "ineligible", reason: UNREACHABLE_REASON })),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(failure({ _tag: "ineligible", reason: UNREACHABLE_REASON })),
          onSome: Effect.succeed,
        }),
      ),
    );
    if (status.authToken === null || status.authToken.trim() === "")
      return yield* failure({ _tag: "auth" });
    const method = decodeAuthMethod(status.authMethod);
    if (Option.isNone(method))
      return yield* failure({ _tag: "ineligible", reason: UNSUPPORTED_SIGN_IN_REASON });
    const token = status.authToken.trim();
    const accountId =
      method.value === "chatgpt"
        ? (chatGptAccountIdFromAccessToken(token) ??
          (yield* input.account).auth.workspaceId ??
          null)
        : null;
    return {
      endpoint: method.value === "apikey" ? OPENAI_API_ENDPOINT : CHATGPT_ENDPOINT,
      token: Redacted.make(token),
      accountId,
      userAgent: honestUserAgent(status.userAgent),
    } satisfies CodexCredentials;
  });

  const acquireCredentials = (refreshToken: boolean) =>
    credentialsLock.withPermits(1)(readCredentials(refreshToken));

  const reject = (credentials: CodexCredentials, status: number) =>
    Effect.gen(function* () {
      const nowMs = yield* Clock.currentTimeMillis;
      yield* Ref.set(rejectedUntilMs, nowMs + REJECTED_COOLDOWN_MS);
      yield* Effect.logWarning("Transcription endpoint rejected the request; pausing the source.", {
        endpoint: credentials.endpoint.name,
        status,
        cooldownMs: REJECTED_COOLDOWN_MS,
      });
      return yield* failure({ _tag: "endpointRejected" });
    });

  const sendOnce = (credentials: CodexCredentials, audio: File, language: string | undefined) =>
    Effect.gen(function* () {
      const request = HttpClientRequest.post(credentials.endpoint.url).pipe(
        HttpClientRequest.bearerToken(credentials.token),
        HttpClientRequest.setHeaders({
          originator: CODEX_CLIENT_NAME,
          "user-agent": credentials.userAgent,
          ...credentials.endpoint.headers,
          ...(credentials.accountId === null
            ? {}
            : { "chatgpt-account-id": credentials.accountId }),
        }),
        HttpClientRequest.acceptJson,
        HttpClientRequest.bodyFormDataRecord({
          file: audio,
          ...credentials.endpoint.fields,
          ...(language === undefined ? {} : { language }),
        }),
      );
      const response = yield* http.execute(request).pipe(
        Effect.catchTags({
          HttpClientError: (error) =>
            Effect.fail(
              failure({
                _tag: "upstream",
                category: error.reason._tag === "TransportError" ? "network" : "bad-response",
                status: null,
              }),
            ),
        }),
      );
      const { status, headers } = response;

      if (headers["cf-mitigated"] !== undefined) return yield* reject(credentials, status);
      if (status === 401)
        return yield* new CredentialsRejected({ endpoint: credentials.endpoint.name });
      if (status === 403 || status === 404 || status === 405 || status === 410)
        return yield* reject(credentials, status);
      if (status === 429)
        return yield* failure({
          _tag: "rateLimited",
          retryAfterSeconds: retryAfterSeconds(headers["retry-after"]),
        });
      if (status === 408) return yield* failure({ _tag: "upstream", category: "timeout", status });
      if (status >= 500) return yield* failure({ _tag: "upstream", category: "server", status });
      if (status === 400 || status === 413 || status === 415 || status === 422)
        return yield* failure({ _tag: "invalidAudio" });
      if (status < 200 || status >= 300)
        return yield* failure({ _tag: "upstream", category: "bad-response", status });
      const body = yield* HttpClientResponse.schemaBodyJson(Schema.Struct({ text: Schema.String }))(
        response,
      ).pipe(
        Effect.mapError(() => failure({ _tag: "upstream", category: "bad-response", status })),
      );
      return { text: body.text };
    }).pipe(
      Effect.timeoutOption(ATTEMPT_TIMEOUT),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(failure({ _tag: "upstream", category: "timeout", status: null })),
          onSome: Effect.succeed,
        }),
      ),
    );

  const transcribeWith = (audio: File, language: string | undefined, refreshToken: boolean) =>
    acquireCredentials(refreshToken).pipe(
      Effect.flatMap((credentials) => withRetries(sendOnce(credentials, audio, language))),
    );

  const isPaused = Effect.gen(function* () {
    const until = yield* Ref.get(rejectedUntilMs);
    return until !== null && (yield* Clock.currentTimeMillis) < until;
  });

  const transcribe: ProviderTranscription["transcribe"] = (clip) =>
    Effect.gen(function* () {
      if (yield* isPaused) return yield* failure({ _tag: "endpointRejected" });
      const bytes = yield* fileSystem
        .readFile(clip.filePath)
        .pipe(Effect.mapError(() => failure({ _tag: "invalidAudio" })));
      const audio = new File([new Uint8Array(bytes)], clip.fileName, { type: clip.mimeType });
      const language = languageCode(clip.language);
      return yield* transcribeWith(audio, language, false).pipe(
        Effect.catchTags({
          CredentialsRejected: (rejected) =>
            rejected.endpoint === "chatgpt"
              ? transcribeWith(audio, language, true)
              : Effect.fail(rejected),
        }),
        Effect.catchTags({
          CredentialsRejected: () => Effect.fail(failure({ _tag: "auth" })),
        }),
      );
    });

  const describe = Effect.gen(function* () {
    const provider = yield* input.account;
    return describeCodexAccount(provider, yield* isPaused);
  });

  return { kind: "codex", describe, transcribe } satisfies ProviderTranscription;
});

export const makeManagedCodexTranscription = (
  account: Effect.Effect<ServerProvider>,
): ProviderTranscription => ({
  kind: "codex",
  describe: account.pipe(
    Effect.map((provider) =>
      provider.enabled
        ? {
            ...ineligible("ChatGPT", UNSUPPORTED_SIGN_IN_REASON),
            accountLabel: provider.auth.email ?? null,
          }
        : null,
    ),
  ),
  transcribe: () =>
    Effect.fail(failure({ _tag: "ineligible", reason: UNSUPPORTED_SIGN_IN_REASON })),
});
