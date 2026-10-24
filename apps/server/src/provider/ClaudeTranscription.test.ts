import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import type { ServerProvider } from "@supaterm/contracts";
import type { TranscriptionClip } from "@supaterm/provider-core/server/transcription";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as References from "effect/References";
import type * as Socket from "effect/socket/Socket";
import * as TestClock from "effect/testing/TestClock";
import { describe } from "vite-plus/test";

import {
  type ClaudeKeychainRead,
  ClaudeKeychainReadError,
  type ClaudeVoiceSocketFactory,
  type ClaudeVoiceUpgradeRejection,
  makeClaudeTranscription,
} from "./ClaudeTranscription.ts";

const CLOSE_STREAM = '{"type":"CloseStream"}';
const fileToken = "file-oauth-token";
const keychainToken = "keychain-oauth-token";

type Listener = (event: Socket.WebSocketEvent) => void;

class FakeVoiceSocket implements Socket.WebSocketLike {
  readyState = 0;
  readonly sent: Array<string | Uint8Array> = [];
  readonly url: URL;
  readonly headers: Readonly<Record<string, string>>;
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly onUpgradeRejected: (rejection: ClaudeVoiceUpgradeRejection) => void;
  private readonly closeStreamSent: Queue.Queue<void>;

  constructor(
    request: Parameters<ClaudeVoiceSocketFactory>[0],
    closeStreamSent: Queue.Queue<void>,
  ) {
    this.url = new URL(request.url);
    this.headers = request.headers;
    this.onUpgradeRejected = request.onUpgradeRejected;
    this.closeStreamSent = closeStreamSent;
  }

  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string | Uint8Array) {
    this.sent.push(data);
    if (data === CLOSE_STREAM) Queue.offerUnsafe(this.closeStreamSent, undefined);
  }

  close(code = 1000, reason?: string) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit("close", { code, ...(reason === undefined ? {} : { reason }) });
  }

  open() {
    this.readyState = 1;
    this.emit("open", {});
  }

  reply(...frames: ReadonlyArray<unknown>) {
    for (const frame of frames) {
      this.emit("message", { data: typeof frame === "string" ? frame : JSON.stringify(frame) });
    }
  }

  rejectUpgrade(rejection: Partial<ClaudeVoiceUpgradeRejection> & { readonly status: number }) {
    this.onUpgradeRejected({ retryAfter: undefined, challenged: false, ...rejection });
    this.emit("error", {});
    this.close(1006);
  }

  fail() {
    this.emit("error", {});
    this.close(1006);
  }

  get audio() {
    return this.sent.filter((message): message is Uint8Array => typeof message !== "string");
  }

  private emit(type: string, event: Socket.WebSocketEvent) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const chunk = (id: string, body: Uint8Array) => {
  const header = Buffer.alloc(8);
  header.write(id, 0, "ascii");
  header.writeUInt32LE(body.byteLength, 4);
  return Buffer.concat([header, body, Buffer.alloc(body.byteLength % 2)]);
};

const fmt = ({ format = 1, channels = 1, sampleRate = 16_000, bits = 16 } = {}) => {
  const body = Buffer.alloc(16);
  body.writeUInt16LE(format, 0);
  body.writeUInt16LE(channels, 2);
  body.writeUInt32LE(sampleRate, 4);
  body.writeUInt32LE((sampleRate * channels * bits) / 8, 8);
  body.writeUInt16LE((channels * bits) / 8, 12);
  body.writeUInt16LE(bits, 14);
  return chunk("fmt ", body);
};

const riff = (...chunks: ReadonlyArray<Uint8Array>) => {
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(4 + chunks.reduce((sum, part) => sum + part.byteLength, 0), 4);
  header.write("WAVE", 8, "ascii");
  return Buffer.concat([header, ...chunks]);
};

const pcm = (bytes: number) =>
  Buffer.from(Array.from({ length: bytes }, (_, index) => index % 251));

const wav = (audio = pcm(6_400), format = fmt()) => riff(format, chunk("data", audio));

const subscription = (
  auth: Partial<ServerProvider["auth"]> = {},
  overrides: Partial<ServerProvider> = {},
) =>
  ({
    enabled: true,
    version: "2.1.310",
    auth: { status: "authenticated", type: "max", email: "dev@example.com", ...auth },
    ...overrides,
  }) as ServerProvider;

const makeHarness = (
  input: {
    readonly platform?: NodeJS.Platform;
    readonly account?: ServerProvider;
    readonly credentialsFileToken?: string | null;
    readonly keychainUsageEnabled?: boolean;
    readonly readKeychain?: ClaudeKeychainRead;
    readonly environment?: NodeJS.ProcessEnv;
    readonly clip?: Uint8Array;
  } = {},
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const configDir = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "claude-transcription-",
    });
    const credentialsFileToken =
      input.credentialsFileToken === undefined ? fileToken : input.credentialsFileToken;
    if (credentialsFileToken !== null)
      yield* fileSystem.writeFileString(
        path.join(configDir, ".credentials.json"),
        JSON.stringify({ claudeAiOauth: { accessToken: credentialsFileToken } }),
      );
    const filePath = path.join(configDir, "pending-clip.wav");
    yield* fileSystem.writeFile(filePath, input.clip ?? wav());

    const sockets = yield* Queue.unbounded<FakeVoiceSocket>();
    const closeStreamSent = yield* Queue.unbounded<void>();
    const opened: Array<FakeVoiceSocket> = [];
    const openSocket: ClaudeVoiceSocketFactory = (request) => {
      const socket = new FakeVoiceSocket(request, closeStreamSent);
      opened.push(socket);
      Queue.offerUnsafe(sockets, socket);
      return socket;
    };
    const settings = { keychainUsageEnabled: input.keychainUsageEnabled ?? false };
    const transcription = yield* makeClaudeTranscription(
      {
        account: Effect.succeed(input.account ?? subscription()),
        configDir,
        environment: input.environment ?? {},
        keychainUsageEnabled: Effect.sync(() => settings.keychainUsageEnabled),
      },
      {
        openSocket,
        readKeychain: input.readKeychain ?? (() => Effect.die("must not read the Keychain")),
      },
    ).pipe(
      Effect.provideService(HostProcess.Platform, input.platform ?? "linux"),
      Effect.provideService(HostProcess.Username, "dev"),
    );
    const clip: TranscriptionClip = {
      filePath,
      fileName: "dictation.wav",
      mimeType: "audio/wav",
      language: "en-US",
    };

    const connect = Effect.gen(function* () {
      const socket = yield* Queue.take(sockets);
      socket.open();
      yield* Queue.take(closeStreamSent);
      return socket;
    });
    return {
      transcription,
      clip,
      opened,
      settings,
      nextSocket: Queue.take(sockets),
      connect,
    };
  });

const layer = NodeServices.layer;

describe("makeClaudeTranscription", () => {
  it.effect("streams the WAV data chunk in 100 ms frames with the CLI's parameters", () =>
    Effect.gen(function* () {
      const audio = pcm(16_200);
      const clip = riff(
        chunk("LIST", Buffer.from("INFOISFT\u0005\u0000\u0000\u0000test\u0000")),
        fmt(),
        chunk("fact", Buffer.alloc(4)),
        chunk("data", audio),
      );
      clip.writeUInt32LE(0xffffffff, clip.byteLength - audio.byteLength - 4);
      const { transcription, clip: input, connect } = yield* makeHarness({ clip });
      const fiber = yield* transcription.transcribe(input).pipe(Effect.forkChild);
      const socket = yield* connect;
      socket.reply({ type: "TranscriptText", data: "hello" }, { type: "TranscriptEndpoint" });
      socket.close(1000);
      expect(yield* Fiber.join(fiber)).toEqual({ text: "hello" });

      expect(`${socket.url.origin}${socket.url.pathname}`).toBe(
        "wss://api.anthropic.com/api/ws/speech_to_text/voice_stream",
      );
      expect(Object.fromEntries(socket.url.searchParams)).toEqual({
        encoding: "linear16",
        sample_rate: "16000",
        channels: "1",
        endpointing_ms: "300",
        utterance_end_ms: "1000",
        language: "en",
        use_conversation_engine: "true",
      });
      expect(socket.headers).toEqual({
        authorization: `Bearer ${fileToken}`,
        "user-agent": "claude-cli/2.1.310 (external, cli)",
        "x-app": "cli",
        "anthropic-client-platform": "claude_code_cli",
      });
      expect(socket.sent[0]).toBe('{"type":"KeepAlive"}');
      expect(socket.sent.at(-1)).toBe(CLOSE_STREAM);
      expect(socket.audio.map((frame) => frame.byteLength)).toEqual([
        3200, 3200, 3200, 3200, 3200, 200,
      ]);
      expect(Buffer.concat(socket.audio)).toEqual(audio);
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("refuses clips that are not 16 kHz mono 16-bit PCM", () =>
    Effect.gen(function* () {
      const clips = [
        wav(pcm(6_400), fmt({ sampleRate: 44_100 })),
        wav(pcm(6_400), fmt({ channels: 2 })),
        wav(pcm(6_400), fmt({ bits: 8 })),
        wav(pcm(6_400), fmt({ format: 3, bits: 32 })),
        riff(fmt()),
        Buffer.from("not a wav file"),
      ];
      for (const clip of clips) {
        const { transcription, clip: input, opened } = yield* makeHarness({ clip });
        expect((yield* transcription.transcribe(input).pipe(Effect.flip)).reason).toEqual({
          _tag: "invalidAudio",
        });
        expect(opened).toHaveLength(0);
      }
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect(
    "commits each endpoint, lets later hypotheses replace earlier ones, and keeps the tail",
    () =>
      Effect.gen(function* () {
        const { transcription, clip, connect } = yield* makeHarness();
        const fiber = yield* transcription.transcribe(clip).pipe(Effect.forkChild);
        const socket = yield* connect;
        socket.reply(
          { type: "TranscriptText", data: "hello" },
          { type: "TranscriptText", data: "hello wor" },
          { type: "TranscriptText", data: "hello world" },
          { type: "TranscriptEndpoint" },
          { type: "TranscriptInterim", data: "second" },
          { type: "TranscriptText", data: "second part" },
          { type: "TranscriptText", data: "" },
          { type: "TranscriptEndpoint" },
          { type: "TranscriptEndpoint" },
          { type: "Metadata", data: { request_id: "abc" } },
          { type: "TranscriptText", data: "and the tail" },
        );
        socket.close(1000);
        expect(yield* Fiber.join(fiber)).toEqual({ text: "hello world second part and the tail" });
      }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("finishes once the server goes quiet, keeping the pending hypothesis", () =>
    Effect.gen(function* () {
      const { transcription, clip, connect } = yield* makeHarness();
      const fiber = yield* transcription.transcribe(clip).pipe(Effect.forkChild);
      const socket = yield* connect;
      socket.reply(
        { type: "TranscriptText", data: "one" },
        { type: "TranscriptEndpoint" },
        { type: "TranscriptText", data: "two" },
      );
      yield* TestClock.adjust("1499 millis");
      expect(fiber.pollUnsafe()).toBeUndefined();
      yield* TestClock.adjust("1 millis");
      expect(yield* Fiber.join(fiber)).toEqual({ text: "one two" });
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("maps refused upgrades", () =>
    Effect.gen(function* () {
      const { transcription, clip, nextSocket } = yield* makeHarness();
      const cases: ReadonlyArray<
        readonly [Parameters<FakeVoiceSocket["rejectUpgrade"]>[0], unknown]
      > = [
        [{ status: 401 }, { _tag: "auth" }],
        [{ status: 403 }, { _tag: "auth" }],
        [
          { status: 429, retryAfter: "7" },
          { _tag: "rateLimited", retryAfterSeconds: 7 },
        ],
        [{ status: 503 }, { _tag: "upstream", category: "server", status: 503 }],
        [{ status: 400 }, { _tag: "upstream", category: "bad-response", status: 400 }],
        [{ status: 403, challenged: true }, { _tag: "endpointRejected" }],
      ];
      for (const [rejection, reason] of cases) {
        const fiber = yield* transcription.transcribe(clip).pipe(Effect.flip, Effect.forkChild);
        (yield* nextSocket).rejectUpgrade(rejection);
        expect((yield* Fiber.join(fiber)).reason).toEqual(reason);
      }
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("maps connection failures and timeouts", () =>
    Effect.gen(function* () {
      const { transcription, clip, nextSocket } = yield* makeHarness();
      const unreachable = yield* transcription.transcribe(clip).pipe(Effect.flip, Effect.forkChild);
      (yield* nextSocket).fail();
      expect((yield* Fiber.join(unreachable)).reason).toEqual({
        _tag: "upstream",
        category: "network",
        status: null,
      });

      const stalled = yield* transcription.transcribe(clip).pipe(Effect.flip, Effect.forkChild);
      yield* nextSocket;
      yield* TestClock.adjust("10 seconds");
      expect((yield* Fiber.join(stalled)).reason).toEqual({
        _tag: "upstream",
        category: "timeout",
        status: null,
      });
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("maps error frames, malformed frames, and abnormal closes", () =>
    Effect.gen(function* () {
      const { transcription, clip, connect } = yield* makeHarness();
      const cases: ReadonlyArray<readonly [(socket: FakeVoiceSocket) => void, unknown]> = [
        [
          (socket) => socket.reply({ type: "error", message: "authentication_error: expired" }),
          { _tag: "auth" },
        ],
        [
          (socket) => socket.reply({ type: "TranscriptError", error_code: "rate_limit_error" }),
          { _tag: "rateLimited", retryAfterSeconds: null },
        ],
        [
          (socket) => socket.reply({ type: "TranscriptError", description: "engine failed" }),
          { _tag: "upstream", category: "server", status: null },
        ],
        [
          (socket) => socket.reply("not json"),
          { _tag: "upstream", category: "bad-response", status: null },
        ],
        [
          (socket) => socket.reply({ type: "TranscriptText", data: 5 }),
          { _tag: "upstream", category: "bad-response", status: null },
        ],
        [(socket) => socket.close(1011), { _tag: "upstream", category: "server", status: null }],
        [(socket) => socket.close(1006), { _tag: "upstream", category: "network", status: null }],
      ];
      for (const [act, reason] of cases) {
        const fiber = yield* transcription.transcribe(clip).pipe(Effect.flip, Effect.forkChild);
        act(yield* connect);
        expect((yield* Fiber.join(fiber)).reason).toEqual(reason);
      }
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("describes only claude.ai subscription logins as eligible", () =>
    Effect.gen(function* () {
      const descriptionOf = (
        account: ServerProvider,
        credentialsFileToken: string | null = fileToken,
      ) =>
        makeHarness({ account, credentialsFileToken }).pipe(
          Effect.flatMap(({ transcription }) => transcription.describe),
        );
      expect(yield* descriptionOf(subscription())).toEqual({
        serviceLabel: "Claude",
        accountLabel: "dev@example.com",
        eligible: true,
        audioFormats: ["wav"],
      });
      expect(yield* descriptionOf(subscription({}, { enabled: false }))).toBeNull();
      expect(yield* descriptionOf(subscription({ status: "unauthenticated" }))).toMatchObject({
        eligible: false,
        unavailableReason: "Sign in to Claude Code to use voice input.",
      });
      expect(yield* descriptionOf(subscription({ status: "unknown" }))).toMatchObject({
        eligible: false,
        unavailableReason: expect.stringContaining("isn't ready"),
      });
      for (const type of ["apiKey", "bedrock", "customEndpoint", undefined]) {
        expect(yield* descriptionOf(subscription({ type }))).toMatchObject({
          eligible: false,
          unavailableReason: expect.stringContaining("can't transcribe"),
        });
      }
      expect(yield* descriptionOf(subscription(), null)).toMatchObject({
        eligible: false,
        unavailableReason: "Sign in to Claude Code to use voice input.",
      });
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("reports a missing login without connecting", () =>
    Effect.gen(function* () {
      const { transcription, clip, opened } = yield* makeHarness({ credentialsFileToken: null });
      expect((yield* transcription.transcribe(clip).pipe(Effect.flip)).reason).toEqual({
        _tag: "auth",
      });
      const unsupported = yield* makeHarness({ account: subscription({ type: "apiKey" }) });
      expect(
        (yield* unsupported.transcription.transcribe(unsupported.clip).pipe(Effect.flip)).reason,
      ).toMatchObject({ _tag: "ineligible" });
      expect([...opened, ...unsupported.opened]).toHaveLength(0);
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("waits for the Keychain opt-in on macOS and never reads it to describe", () =>
    Effect.gen(function* () {
      const reads: Array<readonly [string, string]> = [];
      const { transcription, clip, connect, opened, settings } = yield* makeHarness({
        platform: "darwin",
        credentialsFileToken: null,
        readKeychain: (service, account) =>
          Effect.sync(() => {
            reads.push([service, account]);
            return JSON.stringify({ claudeAiOauth: { accessToken: keychainToken } });
          }),
      });
      expect(yield* transcription.describe).toMatchObject({
        eligible: false,
        unavailableReason: "Allow Keychain access for Claude in Settings → Providers.",
      });
      expect((yield* transcription.transcribe(clip).pipe(Effect.flip)).reason).toEqual({
        _tag: "ineligible",
        reason: "Allow Keychain access for Claude in Settings → Providers.",
      });
      expect(opened).toHaveLength(0);

      settings.keychainUsageEnabled = true;
      expect(yield* transcription.describe).toMatchObject({ eligible: true });
      expect(reads).toHaveLength(0);

      for (let attempt = 0; attempt < 2; attempt++) {
        const fiber = yield* transcription.transcribe(clip).pipe(Effect.forkChild);
        const socket = yield* connect;
        socket.close(1000);
        yield* Fiber.join(fiber);
        expect(socket.headers.authorization).toBe(`Bearer ${keychainToken}`);
      }
      expect(reads).toEqual([["Claude Code-credentials", "dev"]]);
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("names the Keychain item the way the CLI does for its config directory", () =>
    Effect.gen(function* () {
      const itemFor = (environment: NodeJS.ProcessEnv) =>
        Effect.gen(function* () {
          const item = yield* Deferred.make<readonly [string, string]>();
          const { transcription, clip } = yield* makeHarness({
            platform: "darwin",
            credentialsFileToken: null,
            keychainUsageEnabled: true,
            environment,
            readKeychain: (service, account) =>
              Deferred.succeed(item, [service, account]).pipe(Effect.as(null)),
          });
          yield* transcription.transcribe(clip).pipe(Effect.ignore);
          return yield* Deferred.await(item);
        });
      expect(
        yield* itemFor({ CLAUDE_CONFIG_DIR: "/Users/dev/.claude-work", USER: "khoi" }),
      ).toEqual(["Claude Code-credentials-4298c2ba", "khoi"]);
      expect(yield* itemFor({ CLAUDE_CONFIG_DIR: "", USER: "not a user!" })).toEqual([
        "Claude Code-credentials",
        "claude-code-user",
      ]);
      expect(yield* itemFor({})).toEqual(["Claude Code-credentials", "dev"]);
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("tries the Keychain when a leftover credentials file is rejected", () =>
    Effect.gen(function* () {
      const { transcription, clip, nextSocket, connect } = yield* makeHarness({
        platform: "darwin",
        keychainUsageEnabled: true,
        readKeychain: () =>
          Effect.succeed(JSON.stringify({ claudeAiOauth: { accessToken: keychainToken } })),
      });
      const fiber = yield* transcription.transcribe(clip).pipe(Effect.forkChild);
      const stale = yield* nextSocket;
      expect(stale.headers.authorization).toBe(`Bearer ${fileToken}`);
      stale.rejectUpgrade({ status: 401 });
      const current = yield* connect;
      expect(current.headers.authorization).toBe(`Bearer ${keychainToken}`);
      current.reply({ type: "TranscriptText", data: "recovered" });
      current.close(1000);
      expect(yield* Fiber.join(fiber)).toEqual({ text: "recovered" });
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("gives up on an unanswered Keychain prompt and joins it on the next try", () =>
    Effect.gen(function* () {
      let reads = 0;
      const prompted = yield* Deferred.make<void>();
      const allow = yield* Deferred.make<string | null, ClaudeKeychainReadError>();
      const { transcription, clip, connect } = yield* makeHarness({
        platform: "darwin",
        credentialsFileToken: null,
        keychainUsageEnabled: true,
        readKeychain: () =>
          Effect.suspend(() => {
            reads++;
            return Deferred.succeed(prompted, undefined).pipe(
              Effect.andThen(Deferred.await(allow)),
            );
          }),
      });
      const unanswered = yield* transcription.transcribe(clip).pipe(Effect.flip, Effect.forkChild);
      yield* Deferred.await(prompted);
      yield* TestClock.adjust("30 seconds");
      expect((yield* Fiber.join(unanswered)).reason).toMatchObject({ _tag: "ineligible" });

      const retry = yield* transcription.transcribe(clip).pipe(Effect.forkChild);
      yield* Deferred.succeed(
        allow,
        JSON.stringify({ claudeAiOauth: { accessToken: keychainToken } }),
      );
      const socket = yield* connect;
      socket.close(1000);
      yield* Fiber.join(retry);
      expect(socket.headers.authorization).toBe(`Bearer ${keychainToken}`);
      expect(reads).toBe(1);

      const failing = yield* makeHarness({
        platform: "darwin",
        credentialsFileToken: null,
        keychainUsageEnabled: true,
        readKeychain: () =>
          Effect.fail(new ClaudeKeychainReadError({ cause: new Error("denied") })),
      });
      expect(
        (yield* failing.transcription.transcribe(failing.clip).pipe(Effect.flip)).reason,
      ).toMatchObject({ _tag: "ineligible" });
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("keeps the token out of failures and logs", () => {
    const logs: Array<string> = [];
    const logger = Logger.make(({ fiber, message }) => {
      logs.push(JSON.stringify([message, fiber.getRef(References.CurrentLogAnnotations)]));
    });
    return Effect.gen(function* () {
      const { transcription, clip, nextSocket } = yield* makeHarness();
      const fiber = yield* transcription.transcribe(clip).pipe(Effect.flip, Effect.forkChild);
      (yield* nextSocket).rejectUpgrade({ status: 401 });
      const failure = yield* Fiber.join(fiber);
      expect(`${JSON.stringify(failure)} ${String(failure)} ${failure.message}`).not.toContain(
        fileToken,
      );
      expect(logs.length).toBeGreaterThan(0);
      expect(logs.join("\n")).not.toContain(fileToken);
    }).pipe(
      Effect.scoped,
      Effect.provide(Layer.merge(layer, Logger.layer([logger], { mergeWithExisting: false }))),
    );
  });
});
