// @effect-diagnostics nodeBuiltinImport:off - the fixture is a loopback WebSocket server.
import type * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";

import { parseWav } from "@supaterm/provider-core/server/transcription";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as TestClock from "effect/testing/TestClock";
import { WebSocketServer } from "ws";

import {
  claudeKeytermsHeader,
  claudeVoiceStreamRequest,
  runVoiceStream,
  streamClaudeTranscription,
  type VoiceStreamEvent,
} from "./ClaudeTranscription.ts";

const wavBytes = (samples: number) => {
  const file = new Uint8Array(44 + samples * 2);
  const view = new DataView(file.buffer);
  file.set(new TextEncoder().encode("RIFF"), 0);
  view.setUint32(4, 36 + samples * 2, true);
  file.set(new TextEncoder().encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  file.set(new TextEncoder().encode("data"), 36);
  view.setUint32(40, samples * 2, true);
  for (let index = 44; index < file.byteLength; index++) file[index] = index % 251;
  return file;
};

const message = (type: string, data?: string): VoiceStreamEvent => ({
  _tag: "Message",
  data: JSON.stringify(data === undefined ? { type } : { type, data }),
});

const session = (audioMs = 1_000) =>
  Effect.gen(function* () {
    const events = yield* Queue.unbounded<VoiceStreamEvent>();
    const fiber = yield* Effect.forkChild(runVoiceStream({ events, audioMs }));
    const offer = (...batch: ReadonlyArray<VoiceStreamEvent>) =>
      Effect.forEach(batch, (event) => Queue.offer(events, event), { discard: true });
    return { fiber, offer };
  });

describe("claudeKeytermsHeader", () => {
  it("cleans terms the way the CLI does, drops repeats, and stops at its limits", () => {
    expect(
      claudeKeytermsHeader(["Supaterm", "supaterm", "a,b", "  thermos   skill ", "café", ""]),
    ).toBe("Supaterm,a b,thermos skill,caf");
    const many = Array.from({ length: 80 }, (_, index) => `term${index}`);
    expect(claudeKeytermsHeader(many).split(",")).toHaveLength(50);
    const long = Array.from({ length: 50 }, (_, index) => `${"x".repeat(30)}${index}`);
    expect(claudeKeytermsHeader(long).length).toBeLessThanOrEqual(1_024);
  });
});

describe("claudeVoiceStreamRequest", () => {
  it("asks for the CLI's audio format with its identity and keyterms", () => {
    const request = claudeVoiceStreamRequest({
      token: "oauth-token",
      cliVersion: "2.1.310",
      language: "ja",
      keyterms: ["Supaterm", "supaterm", "thermos"],
    });
    const url = new URL(request.url);
    expect(`${url.origin}${url.pathname}`).toBe(
      "wss://api.anthropic.com/api/ws/speech_to_text/voice_stream",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      encoding: "linear16",
      sample_rate: "16000",
      channels: "1",
      endpointing_ms: "300",
      utterance_end_ms: "1000",
      language: "ja",
      use_conversation_engine: "true",
    });
    expect(request.headers).toEqual({
      Authorization: "Bearer oauth-token",
      "User-Agent": "claude-cli/2.1.310 (external, cli)",
      "x-app": "cli",
      "anthropic-client-platform": "claude_code_cli",
      "x-config-keyterms": "Supaterm,thermos",
    });
  });

  it("defaults to English and leaves the keyterm header out when there are none", () => {
    const request = claudeVoiceStreamRequest({
      token: "t",
      cliVersion: "2.1.310",
      language: undefined,
      keyterms: [],
    });
    expect(new URL(request.url).searchParams.get("language")).toBe("en");
    expect("x-config-keyterms" in request.headers).toBe(false);
  });
});

describe("runVoiceStream", () => {
  it.effect("joins committed segments once the server closes normally", () =>
    Effect.gen(function* () {
      const { fiber, offer } = yield* session();
      yield* offer(
        message("TranscriptText", "open the"),
        message("TranscriptText", "open the worktree"),
        message("TranscriptEndpoint"),
        message("TranscriptText", " then run thermos "),
        { _tag: "CloseStreamSent" },
        { _tag: "Closed", code: 1000 },
      );
      expect(yield* Fiber.join(fiber)).toBe("open the worktree then run thermos");
    }),
  );

  it.effect("waits through long gaps between endpoints until the server closes", () =>
    Effect.gen(function* () {
      const { fiber, offer } = yield* session();
      yield* offer(
        { _tag: "CloseStreamSent" },
        message("TranscriptText", "first part"),
        message("TranscriptEndpoint"),
      );
      yield* TestClock.adjust("10 seconds");
      expect(fiber.pollUnsafe()).toBeUndefined();
      yield* offer(message("TranscriptText", "second part"), message("TranscriptEndpoint"), {
        _tag: "Closed",
        code: 1000,
      });
      expect(yield* Fiber.join(fiber)).toBe("first part second part");
    }),
  );

  it.effect("keeps listening after an endpoint that came before CloseStream", () =>
    Effect.gen(function* () {
      const { fiber, offer } = yield* session();
      yield* offer(message("TranscriptText", "first"), message("TranscriptEndpoint"));
      yield* offer({ _tag: "CloseStreamSent" });
      yield* TestClock.adjust("5 seconds");
      expect(fiber.pollUnsafe()).toBeUndefined();
      yield* offer(message("TranscriptText", "second"), { _tag: "Closed", code: 1000 });
      expect(yield* Fiber.join(fiber)).toBe("first second");
    }),
  );

  it.effect("fails at the deadline when the server never finishes", () =>
    Effect.gen(function* () {
      const { fiber, offer } = yield* session(40_000);
      yield* offer({ _tag: "CloseStreamSent" }, message("TranscriptText", "partial"));
      yield* TestClock.adjust("39 seconds");
      expect(fiber.pollUnsafe()).toBeUndefined();
      yield* TestClock.adjust("1 second");
      const error = yield* Effect.flip(Fiber.join(fiber));
      expect(error.reason).toBe("failed");
    }),
  );

  it.effect("fails on an error frame or an abnormal close", () =>
    Effect.gen(function* () {
      for (const ending of [
        [message("TranscriptError", "boom")],
        [{ _tag: "CloseStreamSent" }, { _tag: "Closed", code: 1011 }],
        [{ _tag: "Closed", code: 1000 }],
      ] as ReadonlyArray<ReadonlyArray<VoiceStreamEvent>>) {
        const { fiber, offer } = yield* session();
        yield* offer(message("TranscriptText", "something"), ...ending);
        const error = yield* Effect.flip(Fiber.join(fiber));
        expect(error.reason).toBe("failed");
      }
    }),
  );
});

const withServer = <E>(
  options: {
    readonly reject?: { readonly status: number; readonly headers?: Record<string, string> };
    readonly sendInvalidFrame?: boolean;
  },
  use: (
    url: string,
    received: { headers?: NodeHttp.IncomingHttpHeaders; frames: Array<Buffer | string> },
  ) => Effect.Effect<void, E>,
) =>
  Effect.acquireUseRelease(
    Effect.callback<WebSocketServer>((resume) => {
      const server = new WebSocketServer({
        port: 0,
        host: "127.0.0.1",
        verifyClient: (_info, done) =>
          options.reject
            ? done(false, options.reject.status, "rejected", options.reject.headers)
            : done(true),
      });
      server.once("listening", () => resume(Effect.succeed(server)));
    }),
    (server) => {
      const received: { headers?: NodeHttp.IncomingHttpHeaders; frames: Array<Buffer | string> } = {
        frames: [],
      };
      server.on("connection", (socket, request) => {
        received.headers = request.headers;
        socket.on("message", (data, isBinary) => {
          const frame = isBinary ? Buffer.from(data as Buffer) : data.toString();
          received.frames.push(frame);
          if (frame === '{"type":"CloseStream"}' && options.sendInvalidFrame) {
            // Reserved bits set: the client must treat this as a protocol error.
            (socket as unknown as { _socket: NodeNet.Socket })._socket.write(
              Buffer.from([0xf1, 0]),
            );
          } else if (frame === '{"type":"CloseStream"}') {
            socket.send(JSON.stringify({ type: "TranscriptText", data: "hello from the fixture" }));
            socket.send(JSON.stringify({ type: "TranscriptEndpoint" }));
            socket.close(1000);
          }
        });
      });
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      return use(`ws://127.0.0.1:${port}/voice`, received);
    },
    (server) => Effect.callback<void>((resume) => server.close(() => resume(Effect.void))),
  );

describe("streamClaudeTranscription", () => {
  it.live("sends the headers, a KeepAlive, the PCM in frames, then CloseStream", () =>
    withServer({}, (url, received) =>
      Effect.gen(function* () {
        const audio = parseWav(wavBytes(40_000))!;
        const text = yield* streamClaudeTranscription({
          url,
          headers: { Authorization: "Bearer token", "x-config-keyterms": "supaterm,thermos" },
          audio,
        });
        expect(text).toBe("hello from the fixture");
        expect(received.headers?.authorization).toBe("Bearer token");
        expect(received.headers?.["x-config-keyterms"]).toBe("supaterm,thermos");
        expect(received.frames[0]).toBe('{"type":"KeepAlive"}');
        expect(received.frames.at(-1)).toBe('{"type":"CloseStream"}');
        const binary = received.frames.filter((frame): frame is Buffer => Buffer.isBuffer(frame));
        expect(binary.every((frame) => frame.byteLength <= 32_000)).toBe(true);
        expect(Buffer.concat(binary).equals(Buffer.from(audio.pcm))).toBe(true);
      }),
    ),
  );

  it.live("fails promptly when the connection breaks after the clip is sent", () =>
    withServer({ sendInvalidFrame: true }, (url) =>
      Effect.gen(function* () {
        // A 3-minute clip puts the session deadline past the test timeout, so only a
        // prompt failure passes.
        const error = yield* Effect.flip(
          streamClaudeTranscription({
            url,
            headers: {},
            audio: parseWav(wavBytes(16_000 * 180))!,
          }),
        );
        expect(error.reason).toBe("failed");
      }),
    ),
  );

  it.live.each([
    [{ status: 401 }, "signedOut"],
    [{ status: 403 }, "blocked"],
    [{ status: 429, headers: { "Retry-After": "3" } }, "rateLimited"],
    [{ status: 401, headers: { "cf-mitigated": "challenge" } }, "blocked"],
    [{ status: 500 }, "failed"],
  ] as const)("maps a refused upgrade %j to %s", ([reject, expected]) =>
    withServer({ reject }, (url) =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          streamClaudeTranscription({ url, headers: {}, audio: parseWav(wavBytes(16_000))! }),
        );
        expect(error.reason).toBe(expected);
        if (expected === "rateLimited") expect(error.retryAfterMs).toBe(3_000);
      }),
    ),
  );
});
