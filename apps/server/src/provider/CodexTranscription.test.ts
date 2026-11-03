import * as NodeServices from "@effect/platform-node/NodeServices";
import { TranscriptionError } from "@supaterm/contracts";
import { parseWav } from "@supaterm/provider-core/server/transcription";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import { HttpClient, type HttpClientRequest, HttpClientResponse } from "effect/http";

import { codexTranscriptionStatus, makeCodexTranscription } from "./CodexTranscription.ts";

const AUDIO = (() => {
  const file = new Uint8Array(44 + 32_000);
  const view = new DataView(file.buffer);
  file.set(new TextEncoder().encode("RIFF"), 0);
  view.setUint32(4, 36 + 32_000, true);
  file.set(new TextEncoder().encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  file.set(new TextEncoder().encode("data"), 36);
  view.setUint32(40, 32_000, true);
  return parseWav(file)!;
})();

const jwt = (claims: Record<string, unknown>) =>
  ["header", Buffer.from(JSON.stringify(claims)).toString("base64url"), "signature"].join(".");

// TestClock starts at 0, so an `exp` in seconds after that is unexpired.
const FRESH = jwt({ exp: 3_600, "https://api.openai.com/auth": { chatgpt_account_id: "acct" } });
const ROTATED = jwt({ exp: 7_200, "https://api.openai.com/auth": { chatgpt_account_id: "acct" } });
const EXPIRED = jwt({ exp: 0 });

interface SentRequest {
  readonly headers: Record<string, string>;
  readonly contentType: string | undefined;
  readonly body: Buffer;
}

const boundaryOf = (request: SentRequest | undefined) =>
  request?.contentType?.replace("multipart/form-data; boundary=", "") ?? "";

/** The Codex desktop composer's upload (vCs + SCs in the app's webview bundle). */
const desktopUpload = (boundary: string, language?: string) =>
  Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="codex.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
    ),
    Buffer.from(AUDIO.file),
    Buffer.from("\r\n"),
    Buffer.from(
      language === undefined
        ? ""
        : `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${language}\r\n`,
    ),
    Buffer.from(`--${boundary}--\r\n`),
  ]);

const setup = (input: {
  readonly token?: string | undefined;
  readonly responses: ReadonlyArray<Response>;
  readonly refreshedToken?: string;
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const authHomePath = yield* fs.makeTempDirectoryScoped();
    const writeToken = (token: string) =>
      fs.writeFileString(
        path.join(authHomePath, "auth.json"),
        JSON.stringify({
          auth_mode: "chatgpt",
          tokens: { access_token: token, account_id: "acct" },
        }),
      );
    if (input.token !== undefined) yield* writeToken(input.token);
    const sent = yield* Ref.make<ReadonlyArray<SentRequest>>([]);
    const refreshes = yield* Ref.make(0);
    const pending = [...input.responses];
    const client = HttpClient.make((request: HttpClientRequest.HttpClientRequest) =>
      Effect.gen(function* () {
        const { body } = request;
        yield* Ref.update(sent, (current) => [
          ...current,
          {
            headers: { ...request.headers },
            contentType: body._tag === "Uint8Array" ? body.contentType : undefined,
            body: Buffer.from(body._tag === "Uint8Array" ? body.body : new Uint8Array()),
          },
        ]);
        return HttpClientResponse.fromWeb(
          request,
          pending.shift() ?? Response.json({}, { status: 500 }),
        );
      }),
    );
    const lock = yield* Semaphore.make(1);
    const backend = yield* makeCodexTranscription({
      authHomePath,
      withLoginLock: lock.withPermits(1),
      refreshLogin: Ref.update(refreshes, (count) => count + 1).pipe(
        Effect.andThen(input.refreshedToken ? writeToken(input.refreshedToken) : Effect.void),
        Effect.orDie,
      ),
    }).pipe(Effect.provideService(HttpClient.HttpClient, client));
    return { backend, sent, refreshes, writeToken };
  });

const reason = <A>(effect: Effect.Effect<A, TranscriptionError>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => error.reason),
  );

describe("makeCodexTranscription", () => {
  it.effect("uploads the WAV as the desktop composer does, with only its headers", () =>
    Effect.gen(function* () {
      const { backend, sent } = yield* setup({
        token: FRESH,
        responses: [Response.json({ text: " hello there ", asset_ttl: "30d" })],
      });
      const result = yield* backend.transcribe({ audio: AUDIO, language: "en", keyterms: ["x"] });
      expect(result).toEqual({ text: "hello there" });

      const [request] = yield* Ref.get(sent);
      const boundary = boundaryOf(request);
      expect(boundary).toMatch(
        /^----codex-transcribe-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(request?.headers).toEqual({
        authorization: `Bearer ${FRESH}`,
        "chatgpt-account-id": "acct",
        originator: "Codex Desktop",
        "user-agent": expect.stringMatching(/^Codex Desktop\/\d+\.\d+\.\d+ \(Mac OS; arm64\)$/),
        "accept-language": Intl.DateTimeFormat().resolvedOptions().locale,
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "content-length": String(desktopUpload(boundary, "en").byteLength),
      });
      expect(request?.body).toEqual(desktopUpload(boundary, "en"));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("leaves the language out so the endpoint detects it", () =>
    Effect.gen(function* () {
      const { backend, sent } = yield* setup({
        token: FRESH,
        responses: [Response.json({ text: "hola" })],
      });
      yield* backend.transcribe({ audio: AUDIO, language: undefined, keyterms: [] });
      const [request] = yield* Ref.get(sent);
      expect(request?.body).toEqual(desktopUpload(boundaryOf(request)));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("refreshes an expired token before sending", () =>
    Effect.gen(function* () {
      const { backend, sent, refreshes } = yield* setup({
        token: EXPIRED,
        refreshedToken: ROTATED,
        responses: [Response.json({ text: "ok" })],
      });
      yield* backend.transcribe({ audio: AUDIO, language: undefined, keyterms: [] });
      expect(yield* Ref.get(refreshes)).toBe(1);
      expect((yield* Ref.get(sent))[0]?.headers.authorization).toBe(`Bearer ${ROTATED}`);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("refreshes once on a 401 and retries with the new token", () =>
    Effect.gen(function* () {
      const { backend, sent, refreshes } = yield* setup({
        token: FRESH,
        refreshedToken: ROTATED,
        responses: [new Response("", { status: 401 }), Response.json({ text: "after refresh" })],
      });
      expect(
        yield* backend.transcribe({ audio: AUDIO, language: undefined, keyterms: [] }),
      ).toEqual({ text: "after refresh" });
      expect(yield* Ref.get(refreshes)).toBe(1);
      expect((yield* Ref.get(sent)).map((request) => request.headers.authorization)).toEqual([
        `Bearer ${FRESH}`,
        `Bearer ${ROTATED}`,
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("reports a second 401 as signed out instead of refreshing again", () =>
    Effect.gen(function* () {
      const { backend, refreshes } = yield* setup({
        token: FRESH,
        refreshedToken: ROTATED,
        responses: [new Response("", { status: 401 }), new Response("", { status: 401 })],
      });
      expect(
        yield* reason(backend.transcribe({ audio: AUDIO, language: undefined, keyterms: [] })),
      ).toBe("signedOut");
      expect(yield* Ref.get(refreshes)).toBe(1);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("refreshes once when two instances share a login and both get a 401", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const authHomePath = yield* fs.makeTempDirectoryScoped();
      const write = (token: string) =>
        fs.writeFileString(
          path.join(authHomePath, "auth.json"),
          JSON.stringify({ tokens: { access_token: token, account_id: "a" } }),
        );
      yield* write(FRESH);
      const refreshes = yield* Ref.make(0);
      const firstRefreshStarted = yield* Deferred.make<void>();
      const releaseFirstRefresh = yield* Deferred.make<void>();
      // The driver hands every instance on this auth home the same account lock.
      const sharedLock = yield* Semaphore.make(1);
      const makeInstance = makeCodexTranscription({
        authHomePath,
        withLoginLock: sharedLock.withPermits(1),
        refreshLogin: Effect.gen(function* () {
          yield* Ref.update(refreshes, (count) => count + 1);
          yield* Deferred.succeed(firstRefreshStarted, undefined);
          yield* Deferred.await(releaseFirstRefresh);
          yield* write(ROTATED).pipe(Effect.orDie);
        }),
      }).pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                request.headers.authorization === `Bearer ${ROTATED}`
                  ? Response.json({ text: "ok" })
                  : new Response("", { status: 401 }),
              ),
            ),
          ),
        ),
      );
      const [one, two] = [yield* makeInstance, yield* makeInstance];
      const input = { audio: AUDIO, language: undefined, keyterms: [] };
      const first = yield* Effect.forkChild(one.transcribe(input));
      yield* Deferred.await(firstRefreshStarted);
      const second = yield* Effect.forkChild(two.transcribe(input));
      yield* Deferred.succeed(releaseFirstRefresh, undefined);

      expect(yield* Fiber.join(first)).toEqual({ text: "ok" });
      expect(yield* Fiber.join(second)).toEqual({ text: "ok" });
      expect(yield* Ref.get(refreshes)).toBe(1);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("maps the endpoint's refusals to transcription reasons", () =>
    Effect.gen(function* () {
      const cases = [
        [Response.json({ detail: { code: "audio_too_short" } }, { status: 400 }), "audioTooShort"],
        [
          Response.json({ error: { code: "file_above_max_size" } }, { status: 400 }),
          "audioTooLong",
        ],
        [new Response("", { status: 413 }), "audioTooLong"],
        [new Response("", { status: 415 }), "invalidAudio"],
        [new Response("", { status: 429, headers: { "retry-after": "7" } }), "rateLimited"],
        [new Response("", { status: 403 }), "blocked"],
        [new Response("", { status: 200, headers: { "cf-mitigated": "challenge" } }), "blocked"],
        [new Response("", { status: 503 }), "failed"],
      ] as const;
      for (const [response, expected] of cases) {
        const { backend } = yield* setup({ token: FRESH, responses: [response] });
        expect(
          yield* reason(backend.transcribe({ audio: AUDIO, language: undefined, keyterms: [] })),
        ).toBe(expected);
      }
      const { backend } = yield* setup({
        token: FRESH,
        responses: [new Response("", { status: 429, headers: { "retry-after": "7" } })],
      });
      const limited = yield* Effect.flip(
        backend.transcribe({ audio: AUDIO, language: undefined, keyterms: [] }),
      );
      expect(limited.retryAfterMs).toBe(7_000);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("treats a missing auth.json as a login it can't use", () =>
    Effect.gen(function* () {
      const { backend, sent } = yield* setup({ token: undefined, responses: [] });
      expect(
        yield* reason(backend.transcribe({ audio: AUDIO, language: undefined, keyterms: [] })),
      ).toBe("unsupportedLogin");
      expect(yield* Ref.get(sent)).toHaveLength(0);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("codexTranscriptionStatus", () => {
  it.each([
    [{ status: "authenticated", type: "chatgpt" }, true, { status: "ready" }],
    [
      { status: "authenticated", type: "chatgpt" },
      false,
      { status: "unavailable", reason: "unsupportedLogin" },
    ],
    [
      { status: "authenticated", type: "apiKey" },
      true,
      { status: "unavailable", reason: "unsupportedLogin" },
    ],
    [{ status: "unauthenticated" }, true, { status: "unavailable", reason: "signedOut" }],
    [{ status: "unknown" }, true, undefined],
  ] as const)("%j with auth.json=%s → %j", (auth, authFileExists, expected) => {
    expect(codexTranscriptionStatus(auth, authFileExists)).toEqual(expected);
  });
});
