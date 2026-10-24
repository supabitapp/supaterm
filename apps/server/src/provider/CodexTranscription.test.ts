import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import type { ServerProvider } from "@supaterm/contracts";
import type { TranscriptionClip } from "@supaterm/provider-core/server/transcription";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as References from "effect/References";
import { HttpBody, HttpClient, HttpClientError, HttpClientResponse } from "effect/http";
import type { HttpClientRequest } from "effect/http";
import * as TestClock from "effect/testing/TestClock";
import { describe } from "vite-plus/test";

import packageJson from "../../package.json" with { type: "json" };
import {
  type CodexAuthStatus,
  type CodexAuthStatusProbe,
  makeCodexTranscription,
  makeManagedCodexTranscription,
} from "./CodexTranscription.ts";

const accessToken = [
  "header",
  Buffer.from(
    JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-123" } }),
  ).toString("base64url"),
  "signature",
].join(".");
const apiKey = "sk-test-secret-key";
const userAgent = "supaterm/0.150.0 (Mac OS 26.0.0; arm64) unknown (supaterm; 1.0.0)";

const provider = (auth: ServerProvider["auth"], enabled = true) =>
  ({ enabled, auth }) as ServerProvider;
const chatGptAccount = provider({
  status: "authenticated",
  type: "chatgpt",
  email: "dev@example.com",
});
const apiKeyAccount = provider({ status: "authenticated", type: "apiKey" });

type Reply =
  | {
      readonly status: number;
      readonly body?: unknown;
      readonly headers?: Record<string, string>;
    }
  | "transport-error"
  | "stalled-body";

const makeHarness = (input: {
  readonly replies: ReadonlyArray<Reply>;
  readonly auth?: Partial<CodexAuthStatus>;
  readonly account?: ServerProvider;
}) =>
  Effect.gen(function* () {
    const requests: Array<HttpClientRequest.HttpClientRequest> = [];
    const probes: Array<boolean> = [];
    const replies = [...input.replies];
    const sent = yield* Queue.unbounded<void>();
    const http = HttpClient.make((request) =>
      Effect.suspend(() => {
        requests.push(request);
        Queue.offerUnsafe(sent, undefined);
        const reply = replies.shift() ?? { status: 500 };
        if (reply === "transport-error")
          return Effect.fail(
            new HttpClientError.HttpClientError({
              reason: new HttpClientError.TransportError({ request, cause: new Error("reset") }),
            }),
          );
        if (reply === "stalled-body")
          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response(new ReadableStream(), {
                headers: { "content-type": "application/json" },
              }),
            ),
          );
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
              status: reply.status,
              headers: { "content-type": "application/json", ...reply.headers },
            }),
          ),
        );
      }),
    );
    const probe: CodexAuthStatusProbe = ({ refreshToken }) =>
      Effect.sync(() => {
        probes.push(refreshToken);
        return {
          authMethod: "chatgpt",
          authToken: accessToken,
          userAgent,
          ...input.auth,
        };
      });
    const transcription = yield* makeCodexTranscription(
      {
        account: Effect.succeed(input.account ?? chatGptAccount),
        launch: { binaryPath: "codex" },
      },
      probe,
    ).pipe(Effect.provideService(HttpClient.HttpClient, http));
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "codex-transcription-" });
    const filePath = path.join(directory, "pending-clip.webm");
    yield* fileSystem.writeFile(filePath, new Uint8Array([1, 2, 3, 4]));
    const clip: TranscriptionClip = {
      filePath,
      fileName: "dictation.webm",
      mimeType: "audio/webm",
      language: "en-US",
    };

    const nextRequest = Queue.take(sent).pipe(Effect.andThen(Effect.yieldNow));
    return { transcription, requests, probes, clip, nextRequest };
  });

const formOf = (request: HttpClientRequest.HttpClientRequest) => {
  const body = request.body as HttpBody.HttpBody;
  if (body._tag !== "FormData") throw new Error(`expected a form body, got ${body._tag}`);
  return body.formData;
};

const layer = NodeServices.layer;

describe("makeCodexTranscription", () => {
  it.effect("reads the current credential for each clip after an account change", () =>
    Effect.gen(function* () {
      const auth = { authMethod: "apikey", authToken: "first-test-key" };
      const { transcription, requests, clip, probes } = yield* makeHarness({
        replies: [
          { status: 200, body: { text: "one" } },
          { status: 200, body: { text: "two" } },
        ],
        auth,
        account: apiKeyAccount,
      });
      yield* transcription.transcribe(clip);
      auth.authToken = "second-test-key";
      yield* transcription.transcribe(clip);
      expect(requests.map((request) => request.headers.authorization)).toEqual([
        "Bearer first-test-key",
        "Bearer second-test-key",
      ]);
      expect(probes).toEqual([false, false]);
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("times out a response that sends headers but never finishes its body", () =>
    Effect.gen(function* () {
      const { transcription, clip, nextRequest } = yield* makeHarness({
        replies: ["stalled-body", "stalled-body", "stalled-body"],
      });
      const fiber = yield* transcription.transcribe(clip).pipe(Effect.flip, Effect.forkChild);
      yield* nextRequest;
      yield* TestClock.adjust("62 seconds");
      yield* nextRequest;
      yield* TestClock.adjust("64 seconds");
      yield* nextRequest;
      yield* TestClock.adjust("60 seconds");
      expect((yield* Fiber.join(fiber)).reason).toEqual({
        _tag: "upstream",
        category: "timeout",
        status: null,
      });
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("posts a ChatGPT sign-in to the ChatGPT endpoint with an honest identity", () =>
    Effect.gen(function* () {
      const { transcription, requests, clip } = yield* makeHarness({
        replies: [{ status: 200, body: { text: "hello" } }],
      });
      expect(yield* transcription.transcribe(clip)).toEqual({ text: "hello" });
      const [request] = requests;
      expect(request?.method).toBe("POST");
      expect(request?.url).toBe("https://chatgpt.com/backend-api/transcribe");
      expect(request?.headers).toMatchObject({
        authorization: `Bearer ${accessToken}`,
        "chatgpt-account-id": "acct-123",
        originator: "supaterm",
        "user-agent": userAgent,
      });
      expect(request?.headers["user-agent"]).not.toMatch(/Mozilla|Chrome|Safari|Codex Desktop/);
      const form = formOf(request!);
      const file = form.get("file") as File;
      expect(file.name).toBe("dictation.webm");
      expect(file.type).toBe("audio/webm");
      expect(form.get("language")).toBe("en");
      expect(form.get("model")).toBeNull();
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("posts an API key to the documented transcription API", () =>
    Effect.gen(function* () {
      const { transcription, requests, clip } = yield* makeHarness({
        replies: [{ status: 200, body: { text: "from the api" } }],
        auth: { authMethod: "apikey", authToken: apiKey },
        account: apiKeyAccount,
      });
      expect(yield* transcription.transcribe(clip)).toEqual({ text: "from the api" });
      const [request] = requests;
      expect(request?.url).toBe("https://api.openai.com/v1/audio/transcriptions");
      expect(request?.headers.authorization).toBe(`Bearer ${apiKey}`);
      expect(request?.headers["chatgpt-account-id"]).toBeUndefined();
      expect(request?.headers.originator).toBe("supaterm");
      expect(formOf(request!).get("model")).toBe("gpt-4o-mini-transcribe");
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("names Supaterm itself when app-server reports another client's user agent", () =>
    Effect.gen(function* () {
      const { transcription, requests, clip } = yield* makeHarness({
        replies: [{ status: 200, body: { text: "ok" } }],
        auth: { userAgent: "codex_cli_rs/0.150.0" },
      });
      yield* transcription.transcribe(clip);
      expect(requests[0]?.headers["user-agent"]).toBe(`supaterm/${packageJson.version}`);
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("retries network failures and 5xx with backoff, reusing the credentials", () =>
    Effect.gen(function* () {
      const { transcription, requests, probes, clip, nextRequest } = yield* makeHarness({
        replies: [{ status: 503 }, "transport-error", { status: 200, body: { text: "third" } }],
      });
      const fiber = yield* transcription.transcribe(clip).pipe(Effect.forkChild);
      yield* nextRequest;
      yield* TestClock.adjust("1999 millis");
      expect(requests).toHaveLength(1);
      yield* TestClock.adjust("1 millis");
      yield* nextRequest;
      yield* TestClock.adjust("3999 millis");
      expect(requests).toHaveLength(2);
      yield* TestClock.adjust("1 millis");
      expect(yield* Fiber.join(fiber)).toEqual({ text: "third" });
      expect(requests).toHaveLength(3);
      expect(probes).toEqual([false]);
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("gives up after three attempts", () =>
    Effect.gen(function* () {
      const { transcription, requests, clip, nextRequest } = yield* makeHarness({
        replies: [{ status: 502 }, { status: 503 }, { status: 504 }, { status: 200 }],
      });
      const fiber = yield* transcription.transcribe(clip).pipe(Effect.flip, Effect.forkChild);
      yield* nextRequest;
      yield* TestClock.adjust("2 seconds");
      yield* nextRequest;
      yield* TestClock.adjust("4 seconds");
      const failure = yield* Fiber.join(fiber);
      expect(failure.reason).toEqual({ _tag: "upstream", category: "server", status: 504 });
      expect(requests).toHaveLength(3);
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("refreshes a rejected ChatGPT token once, then reports the sign-in", () =>
    Effect.gen(function* () {
      const recovered = yield* makeHarness({
        replies: [{ status: 401 }, { status: 200, body: { text: "after refresh" } }],
      });
      expect(yield* recovered.transcription.transcribe(recovered.clip)).toEqual({
        text: "after refresh",
      });
      expect(recovered.probes).toEqual([false, true]);

      const expired = yield* makeHarness({ replies: [{ status: 401 }, { status: 401 }] });
      const failure = yield* expired.transcription.transcribe(expired.clip).pipe(Effect.flip);
      expect(failure.reason).toEqual({ _tag: "auth" });
      expect(expired.requests).toHaveLength(2);
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("reports a rejected API key without refreshing it", () =>
    Effect.gen(function* () {
      const { transcription, requests, probes, clip } = yield* makeHarness({
        replies: [{ status: 401 }],
        auth: { authMethod: "apikey", authToken: apiKey },
        account: apiKeyAccount,
      });
      const failure = yield* transcription.transcribe(clip).pipe(Effect.flip);
      expect(failure.reason).toEqual({ _tag: "auth" });
      expect(requests).toHaveLength(1);
      expect(probes).toEqual([false]);
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("pauses the source after a 403 or a challenge instead of working around it", () =>
    Effect.gen(function* () {
      const { transcription, requests, clip } = yield* makeHarness({
        replies: [
          { status: 403 },
          { status: 200, headers: { "cf-mitigated": "challenge" } },
          { status: 200, body: { text: "unused" } },
        ],
      });
      expect((yield* transcription.transcribe(clip).pipe(Effect.flip)).reason).toEqual({
        _tag: "endpointRejected",
      });
      expect(requests).toHaveLength(1);
      expect(yield* transcription.describe).toMatchObject({
        serviceLabel: "ChatGPT",
        eligible: false,
        unavailableReason: expect.stringContaining("Try again later"),
      });
      expect((yield* transcription.transcribe(clip).pipe(Effect.flip)).reason).toEqual({
        _tag: "endpointRejected",
      });
      expect(requests).toHaveLength(1);
      yield* TestClock.adjust("15 minutes");
      expect(yield* transcription.describe).toMatchObject({ eligible: true });
      expect((yield* transcription.transcribe(clip).pipe(Effect.flip)).reason).toEqual({
        _tag: "endpointRejected",
      });
      expect(requests).toHaveLength(2);
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("reports rate limits with the server's wait and does not retry them", () =>
    Effect.gen(function* () {
      const { transcription, requests, clip } = yield* makeHarness({
        replies: [{ status: 429, headers: { "retry-after": "12" } }, { status: 200 }],
      });
      expect((yield* transcription.transcribe(clip).pipe(Effect.flip)).reason).toEqual({
        _tag: "rateLimited",
        retryAfterSeconds: 12,
      });
      expect(requests).toHaveLength(1);
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("keeps credentials out of failures and logs", () => {
    const logs: Array<string> = [];
    const logger = Logger.make(({ fiber, message }) => {
      logs.push(JSON.stringify([message, fiber.getRef(References.CurrentLogAnnotations)]));
    });
    return Effect.gen(function* () {
      const { transcription, clip, nextRequest } = yield* makeHarness({
        replies: [{ status: 403 }, "transport-error", "transport-error", "transport-error"],
      });
      const rejected = yield* transcription.transcribe(clip).pipe(Effect.flip);
      yield* nextRequest;
      yield* TestClock.adjust("15 minutes");
      const fiber = yield* transcription.transcribe(clip).pipe(Effect.flip, Effect.forkChild);
      yield* nextRequest;
      yield* TestClock.adjust("2 seconds");
      yield* nextRequest;
      yield* TestClock.adjust("4 seconds");
      const unreachable = yield* Fiber.join(fiber);
      for (const failure of [rejected, unreachable]) {
        const rendered = `${JSON.stringify(failure)} ${String(failure)} ${failure.message}`;
        expect(rendered).not.toContain(accessToken);
        expect(rendered).not.toContain("acct-123");
      }
      expect(logs.length).toBeGreaterThan(0);
      expect(logs.join("\n")).not.toContain(accessToken);
    }).pipe(
      Effect.scoped,
      Effect.provide(Layer.merge(layer, Logger.layer([logger], { mergeWithExisting: false }))),
    );
  });

  it.effect("describes accounts that cannot transcribe", () =>
    Effect.gen(function* () {
      const describe = (account: ServerProvider) =>
        makeHarness({ replies: [], account }).pipe(
          Effect.flatMap(({ transcription }) => transcription.describe),
        );
      expect(yield* describe(provider({ status: "unauthenticated" }))).toMatchObject({
        eligible: false,
        unavailableReason: "Sign in to Codex to transcribe.",
      });
      expect(
        yield* describe(provider({ status: "authenticated", type: "amazonBedrock" })),
      ).toMatchObject({
        eligible: false,
        unavailableReason: expect.stringContaining("can't transcribe"),
      });
      expect(
        yield* describe(provider({ status: "authenticated", type: "chatgpt" }, false)),
      ).toBeNull();
      expect(yield* describe(apiKeyAccount)).toEqual({
        serviceLabel: "OpenAI API",
        accountLabel: null,
        eligible: true,
        audioFormats: ["webm", "ogg", "mp4", "m4a", "wav"],
      });
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );
});

describe("makeManagedCodexTranscription", () => {
  it.effect("lists managed sign-in as unable to transcribe", () =>
    Effect.gen(function* () {
      const transcription = makeManagedCodexTranscription(Effect.succeed(chatGptAccount));
      expect(yield* transcription.describe).toEqual({
        serviceLabel: "ChatGPT",
        accountLabel: "dev@example.com",
        eligible: false,
        unavailableReason:
          "This sign-in method can't transcribe. Add a Codex account signed in with the Codex CLI or an OpenAI API key.",
        audioFormats: [],
      });
      const failure = yield* transcription
        .transcribe({ filePath: "/missing", fileName: "dictation.webm", mimeType: "audio/webm" })
        .pipe(Effect.flip);
      expect(failure.reason._tag).toBe("ineligible");
    }),
  );
});
