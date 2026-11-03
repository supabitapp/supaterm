// @effect-diagnostics nodeBuiltinImport:off - the fixture is a loopback WebSocket server.
import type * as NodeHttp from "node:http";

import { TranscriptionError } from "@supaterm/contracts";
import { describe, expect, it } from "@effect/vitest";
import type * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { WebSocketServer } from "ws";

import {
  type DictationStep,
  initialDictationState,
  stepDictation,
  streamCodexDictation,
} from "./CodexDictationStream.ts";

const frame = (value: Record<string, unknown>) => JSON.stringify(value);

const run = (frames: ReadonlyArray<Record<string, unknown>>): DictationStep => {
  let state = initialDictationState;
  for (const data of frames) {
    const step = stepDictation(state, frame(data));
    if (step._tag !== "Continue") return step;
    state = step.state;
  }
  return { _tag: "Continue", state };
};

describe("stepDictation", () => {
  it("keeps each utterance's newest revision in first-seen order and ends only when the session closes", () => {
    const final = (utterance_id: string, revision: number, text: string) => ({
      type: "transcript.final",
      utterance_id,
      revision,
      text,
    });
    const open = run([
      { type: "session.started" },
      final("a", 0, "open the"),
      final("b", 0, "then run"),
      final("a", 2, "open the worktree"),
      final("a", 1, "stale"),
      { type: "speech.started" },
    ]);
    expect(open._tag === "Continue" && open.state.speaking).toBe(true);
    expect(
      run([
        final("a", 0, "open the"),
        final("b", 0, "then run"),
        final("a", 2, "open the worktree"),
        final("a", 1, "stale"),
        { type: "session.updated", session: { status: "active" } },
        { type: "session.updated", session: { status: "closed" } },
      ]),
    ).toEqual({ _tag: "Done", text: "open the worktree then run" });
  });

  it("fails on a failed transcript or a fatal error, and carries on past a recoverable one", () => {
    expect(run([{ type: "transcript.failed" }])._tag).toBe("Failed");
    expect(run([{ type: "session.error", fatal: true }])._tag).toBe("Failed");
    expect(run([{ type: "session.error", fatal: false }])._tag).toBe("Continue");
  });
});

interface Fixture {
  readonly url: string;
  readonly sessions: Array<{ readonly start: unknown; frames: Array<Buffer>; closed: boolean }>;
  readonly headers: Array<NodeHttp.IncomingHttpHeaders>;
  readonly firstAudio: Deferred.Deferred<void>;
  readonly firstClosed: Deferred.Deferred<void>;
}

const sizes = (frames: ReadonlyArray<Buffer>) => frames.map((frame) => frame.byteLength);
const CLOSING_SILENCE = Buffer.alloc(8_000);
/** A session's frames without the 250 ms of silence the desktop app ends each one with. */
const audioOf = (frames: ReadonlyArray<Buffer>) => {
  expect(frames.at(-1)).toEqual(CLOSING_SILENCE);
  return Buffer.concat(frames.slice(0, -1));
};

const withServer = <E>(
  options: { readonly refuse?: ReadonlyArray<number>; readonly stopFirstSession?: boolean },
  use: (fixture: Fixture) => Effect.Effect<void, E>,
) => {
  const refusals = [...(options.refuse ?? [])];
  return Effect.acquireUseRelease(
    Effect.callback<WebSocketServer>((resume) => {
      const server = new WebSocketServer({
        port: 0,
        host: "127.0.0.1",
        handleProtocols: (protocols) =>
          protocols.has("chatgpt-dictation") ? "chatgpt-dictation" : false,
        verifyClient: (_info, done) => {
          const status = refusals.shift();
          if (status === undefined) done(true);
          else done(false, status, "refused");
        },
      });
      server.once("listening", () => resume(Effect.succeed(server)));
    }),
    (server) => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      const fixture: Fixture = {
        url: `ws://127.0.0.1:${port}/dictation`,
        sessions: [],
        headers: [],
        firstAudio: Deferred.makeUnsafe(),
        firstClosed: Deferred.makeUnsafe(),
      };
      server.on("connection", (socket, request) => {
        fixture.headers.push(request.headers);
        const session = { start: undefined as unknown, frames: [] as Array<Buffer>, closed: false };
        fixture.sessions.push(session);
        socket.on("message", (data) => {
          const message = JSON.parse(data.toString()) as { type: string; audio?: string };
          if (message.type === "session.start") {
            Object.assign(session, { start: message });
            socket.send(frame({ type: "session.started", session: { status: "active" } }));
          } else if (message.type === "audio.append") {
            session.frames.push(Buffer.from(message.audio ?? "", "base64"));
            Deferred.doneUnsafe(fixture.firstAudio, Effect.void);
            if (options.stopFirstSession && session === fixture.sessions[0]) {
              socket.send(frame({ type: "session.stop_requested", grace_period_ms: 1_000 }));
            }
          } else if (message.type === "session.close") {
            session.closed = true;
            if (session === fixture.sessions[0])
              Deferred.doneUnsafe(fixture.firstClosed, Effect.void);
            const part = `part ${fixture.sessions.length}`;
            socket.send(
              frame({ type: "transcript.final", utterance_id: "u", revision: 0, text: part }),
            );
            socket.send(frame({ type: "session.updated", session: { status: "closed" } }));
          }
        });
      });
      return use(fixture);
    },
    (server) => Effect.callback<void>((resume) => server.close(() => resume(Effect.void))),
  );
};

const headers = () => Effect.succeed({ Authorization: "Bearer token" });

describe("streamCodexDictation", () => {
  it.live(
    "starts a session, streams audio while it is recorded, and returns the finals once closed",
    () =>
      withServer({}, (fixture) =>
        Effect.gen(function* () {
          const microphone = yield* Queue.unbounded<Uint8Array, Cause.Done>();
          const fiber = yield* Effect.forkChild(
            streamCodexDictation({
              url: fixture.url,
              headers,
              language: "en",
              audio: Stream.fromQueue(microphone),
            }),
          );
          yield* Queue.offer(microphone, new Uint8Array(3_200).fill(1));
          yield* Deferred.await(fixture.firstAudio);
          expect(fixture.sessions[0]?.closed).toBe(false);
          yield* Queue.offer(microphone, new Uint8Array(3_200).fill(2));
          yield* Queue.end(microphone);

          expect(yield* Fiber.join(fiber)).toBe("part 1");
          const [session] = fixture.sessions;
          expect(session?.start).toEqual({
            type: "session.start",
            client_capabilities: ["server_stop_requested"],
            config: {
              language: "en",
              input_audio_format: "pcm16",
              sample_rate_hz: 16_000,
              num_channels: 1,
              max_buffer_size_bytes: 4_194_304,
              max_utterance_duration_ms: 30_000,
              session_ttl_ms: 300_000,
              provider_mode: "streaming_sse",
              transcript_delivery_mode: "segment",
              vad: {
                type: "server_vad",
                threshold: 0.5,
                prefix_padding_ms: 300,
                silence_duration_ms: 500,
              },
            },
          });
          // The desktop worklet's frames: one 128-sample quantum, then 2048 samples at a time.
          expect(sizes(session!.frames)).toEqual([256, 4_096, 2_048, 8_000]);
          expect(audioOf(session!.frames)).toEqual(
            Buffer.concat([Buffer.alloc(3_200, 1), Buffer.alloc(3_200, 2)]),
          );
          expect(session?.closed).toBe(true);
          expect(fixture.headers[0]?.["sec-websocket-protocol"]).toBe(
            "chatgpt-dictation,codex-desktop",
          );
        }),
      ),
  );

  it.live("renews a login the server signed out once, and reports a refusal as nothing spent", () =>
    Effect.gen(function* () {
      yield* withServer({ refuse: [401] }, (fixture) =>
        Effect.gen(function* () {
          const asked: Array<boolean> = [];
          const text = yield* streamCodexDictation({
            url: fixture.url,
            headers: (refresh) =>
              Effect.sync(() => asked.push(refresh)).pipe(Effect.andThen(headers())),
            language: undefined,
            audio: Stream.make(new Uint8Array(3_200)),
          });
          expect(text).toBe("part 1");
          expect(asked).toEqual([false, true]);
        }),
      );
      yield* withServer({ refuse: [403] }, (fixture) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(
            streamCodexDictation({
              url: fixture.url,
              headers,
              language: undefined,
              audio: Stream.make(new Uint8Array(3_200)),
            }),
          );
          if (error._tag !== "LiveTranscriptionUnavailable") throw error;
          expect(error.cause).toEqual(new TranscriptionError({ reason: "blocked" }));
          expect(fixture.sessions).toHaveLength(0);
        }),
      );
    }),
  );

  it.live("hands a five-minute dictation to a second session before the first one expires", () =>
    withServer({}, (fixture) =>
      Effect.gen(function* () {
        const second = new Uint8Array(32_000);
        const text = yield* streamCodexDictation({
          url: fixture.url,
          headers,
          language: undefined,
          audio: Stream.fromIterable(Array.from({ length: 300 }, () => second)),
        });
        expect(text).toBe("part 1 part 2");
        const [early, late] = fixture.sessions.map((session) => audioOf(session.frames));
        expect(early!.byteLength).toBeGreaterThanOrEqual(240 * 32_000);
        expect(early!.byteLength).toBeLessThan(240 * 32_000 + 4_096);
        expect(early!.byteLength + late!.byteLength).toBe(300 * 32_000);
        expect(fixture.sessions.every((session) => session.closed)).toBe(true);
      }),
    ),
  );

  it.live(
    "closes the session the server asks to stop at once, and moves later audio to a new one",
    () =>
      withServer({ stopFirstSession: true }, (fixture) =>
        Effect.gen(function* () {
          const microphone = yield* Queue.unbounded<Uint8Array, Cause.Done>();
          const fiber = yield* Effect.forkChild(
            streamCodexDictation({
              url: fixture.url,
              headers,
              language: undefined,
              audio: Stream.fromQueue(microphone),
            }),
          );
          yield* Queue.offer(microphone, new Uint8Array(300).fill(3));
          yield* Deferred.await(fixture.firstClosed);
          yield* Queue.offer(microphone, new Uint8Array(4_096).fill(4));
          yield* Queue.end(microphone);

          expect(yield* Fiber.join(fiber)).toBe("part 1 part 2");
          expect(fixture.sessions.map((session) => sizes(session.frames))).toEqual([
            [256, 44, 8_000],
            [4_096, 8_000],
          ]);
          expect(fixture.sessions.every((session) => session.closed)).toBe(true);
        }),
      ),
  );
});
