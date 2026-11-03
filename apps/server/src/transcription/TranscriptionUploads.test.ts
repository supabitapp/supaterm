// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  MessageId,
  type OrchestrationV2ServerCommand,
  ProviderInstanceId,
  ThreadId,
  TRANSCRIPTION_STREAM_CLOSED_CODE,
  TranscriptionError,
  type TranscriptionPrepareUploadInput,
} from "@supaterm/contracts";
import { LiveTranscriptionUnavailable } from "@supaterm/provider-core/server/transcription";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Socket from "effect/socket/Socket";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import {
  OrchestratorCommandRejectedError,
  type OrchestratorV2DispatchResult,
  type OrchestratorV2Error,
} from "../orchestration-v2/Orchestrator.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as Transcription from "./Transcription.ts";
import * as TranscriptionUploads from "./TranscriptionUploads.ts";

const INSTANCE = ProviderInstanceId.make("claude_test");
const THREAD = ThreadId.make("thread-1");
const AUDIO = new Uint8Array([1, 2, 3, 4, 5, 6]);
const AUDIO_BODY = Stream.make(AUDIO);

const submit = (commandId: string) => ({
  threadId: THREAD,
  commandId: CommandId.make(commandId),
  messageId: MessageId.make(`message-${commandId}`),
});

/** What the fake vendor does with a live dictation once it starts. */
type LivePlan =
  | { readonly _tag: "refuse" }
  | {
      readonly _tag: "transcribe";
      readonly result: Effect.Effect<{ text: string }, TranscriptionError>;
    };

const environment = ServerSecretStore.layer.pipe(
  Layer.provideMerge(
    ServerConfig.layerTest(process.cwd(), { prefix: "supaterm-transcription-uploads-" }),
  ),
  Layer.provideMerge(NodeServices.layer),
);

const makeHarness = Effect.gen(function* () {
  const transcriptions = yield* Ref.make<ReadonlyArray<Transcription.TranscribeFileInput>>([]);
  const transcribing = yield* Queue.unbounded<string>();
  const transcripts = yield* Queue.unbounded<Effect.Effect<{ text: string }, TranscriptionError>>();
  const dispatches = yield* Queue.unbounded<OrchestrationV2ServerCommand>();
  const dispatchReplies =
    yield* Queue.unbounded<Effect.Effect<OrchestratorV2DispatchResult, OrchestratorV2Error>>();
  const sourceUsable = yield* Ref.make(true);
  const livePlans = yield* Queue.unbounded<LivePlan>();
  const liveAudio = yield* Queue.unbounded<Uint8Array>();
  const liveEnded = yield* Queue.unbounded<void>();
  const layer = TranscriptionUploads.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(Transcription.Transcription)({
          checkSource: (input) =>
            Effect.flatMap(Ref.get(sourceUsable), (usable) =>
              usable
                ? Effect.succeed(input.providerInstanceId ?? INSTANCE)
                : Effect.fail(new TranscriptionError({ reason: "signedOut" })),
            ),
          transcribeFile: (input) =>
            Ref.update(transcriptions, (current) => [...current, input]).pipe(
              Effect.andThen(Queue.offer(transcribing, NodeFS.readFileSync(input.path, "hex"))),
              Effect.andThen(Queue.take(transcripts)),
              Effect.flatten,
            ),
          transcribeLive: (input) =>
            Effect.gen(function* () {
              const plan = yield* Queue.take(livePlans);
              if (plan._tag === "refuse") {
                return yield* new LiveTranscriptionUnavailable({
                  cause: new TranscriptionError({ reason: "blocked" }),
                });
              }
              yield* Stream.runForEach(input.audio, (chunk) => Queue.offer(liveAudio, chunk));
              yield* Queue.offer(liveEnded, undefined);
              return yield* plan.result;
            }),
        }),
        Layer.mock(ThreadManagement.ThreadManagementService)({
          dispatch: (command) =>
            Queue.offer(dispatches, command).pipe(
              Effect.andThen(Queue.take(dispatchReplies)),
              Effect.flatten,
            ),
        }),
      ),
    ),
  );
  return {
    transcriptions,
    transcribing,
    transcripts,
    dispatches,
    dispatchReplies,
    sourceUsable,
    livePlans,
    liveAudio,
    liveEnded,
    layer,
  };
});

const wavOf = (pcm: Uint8Array) => {
  const file = new Uint8Array(44 + pcm.byteLength);
  const view = new DataView(file.buffer);
  file.set(new TextEncoder().encode("RIFF"), 0);
  view.setUint32(4, 36 + pcm.byteLength, true);
  file.set(new TextEncoder().encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  file.set(new TextEncoder().encode("data"), 36);
  view.setUint32(40, pcm.byteLength, true);
  file.set(pcm, 44);
  return file;
};

const frame = (byte: number) => new Uint8Array(3_200).fill(byte);

/** A client connection: `sent` is what the server wrote, close codes as numbers. */
const connect = Effect.fnUntraced(function* (
  relativeUrl: string,
  revoked: Effect.Effect<void> = Effect.never,
) {
  const uploads = yield* TranscriptionUploads.TranscriptionUploads;
  const inbound = yield* Queue.unbounded<Uint8Array | string, Socket.SocketError>();
  const sent = yield* Queue.unbounded<string | number>();
  const socket = Socket.make({
    reader: Effect.succeed({
      pull: Effect.map(Queue.take(inbound), (item) => [item] as const),
      upgrade: () => Effect.void,
    }),
    writer: Effect.succeed({
      write: (chunk) =>
        Queue.offer(sent, chunk instanceof Socket.CloseEvent ? chunk.code : String(chunk)),
      writeAll: (chunks) => Queue.offerAll(sent, chunks.map(String)),
    }),
  });
  const fiber = yield* Effect.forkChild(
    Effect.scoped(
      uploads.attachStream(
        relativeUrl.slice(`${TranscriptionUploads.TRANSCRIPTION_STREAM_ROUTE_PREFIX}/`.length),
        socket,
        () => revoked,
      ),
    ),
  );
  return {
    fiber,
    sent,
    send: (item: Uint8Array | string) => Queue.offer(inbound, item),
    finish: Queue.offer(inbound, '{"type":"finish"}'),
    drop: Queue.fail(
      inbound,
      new Socket.SocketError({ reason: new Socket.SocketReadError({ cause: "gone" }) }),
    ),
  };
});

const prepareStream = Effect.fnUntraced(function* (uploadId: string) {
  const uploads = yield* TranscriptionUploads.TranscriptionUploads;
  return yield* uploads.prepareStream({ uploadId, providerInstanceId: INSTANCE }, "session-1");
});

/** Collects a streamed dictation the way a client does once its stream is finished. */
const collect = Effect.fnUntraced(function* (
  uploadId: string,
  body?: Uint8Array,
  extra: Omit<TranscriptionPrepareUploadInput, "providerInstanceId" | "sizeBytes"> = {},
) {
  const uploads = yield* TranscriptionUploads.TranscriptionUploads;
  const prepared = yield* uploads
    .prepare({
      providerInstanceId: INSTANCE,
      sizeBytes: body?.byteLength ?? 1,
      uploadId,
      ...extra,
    })
    .pipe(Effect.catchTags({ AttachmentUploadSigningKeyError: Effect.die }));
  return yield* upload(tokenOf(prepared.relativeUrl), body && Stream.make(body));
});

const tokenOf = (relativeUrl: string) =>
  relativeUrl.slice(`${TranscriptionUploads.TRANSCRIPTION_UPLOAD_ROUTE_PREFIX}/`.length);

const prepare = Effect.fnUntraced(function* (
  input: Omit<TranscriptionPrepareUploadInput, "providerInstanceId" | "sizeBytes">,
) {
  const uploads = yield* TranscriptionUploads.TranscriptionUploads;
  return yield* uploads.prepare({
    providerInstanceId: INSTANCE,
    sizeBytes: AUDIO.byteLength,
    ...input,
  });
});

const upload = Effect.fnUntraced(function* (
  token: string,
  body: Stream.Stream<Uint8Array> | undefined,
) {
  const uploads = yield* TranscriptionUploads.TranscriptionUploads;
  return yield* uploads.receive(token, body);
});

const cancel = Effect.fnUntraced(function* (uploadId: string) {
  const uploads = yield* TranscriptionUploads.TranscriptionUploads;
  return yield* uploads.cancel({ uploadId });
});

const reason = <A, R>(effect: Effect.Effect<A, TranscriptionError, R>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => error.reason),
  );

const leftoverFiles = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const directory = NodePath.join(config.stateDir, "transcription-uploads");
  return NodeFS.existsSync(directory) ? NodeFS.readdirSync(directory) : [];
});

describe("TranscriptionUploads", () => {
  it.effect("answers with the transcript and keeps nothing on disk", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      yield* Effect.gen(function* () {
        const prepared = yield* prepare({});
        const pending = yield* Effect.forkChild(upload(tokenOf(prepared.relativeUrl), AUDIO_BODY));
        expect(yield* Queue.take(harness.transcribing)).toBe(Buffer.from(AUDIO).toString("hex"));
        yield* Queue.offer(harness.transcripts, Effect.succeed({ text: "hello" }));

        expect(yield* Fiber.join(pending)).toEqual({ text: "hello" });
        expect(yield* Queue.size(harness.dispatches)).toBe(0);
        expect(yield* leftoverFiles).toEqual([]);
      }).pipe(Effect.provide(harness.layer));
    }).pipe(Effect.provide(environment)),
  );

  it.effect("sends the prompt after the uploader disconnects, and a replay recovers it", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      yield* Effect.gen(function* () {
        const target = { ...submit("command-1"), delivery: "queue" as const };
        const prepared = yield* prepare({ submit: target });
        expect(prepared.uploadId).toBe("command-1");
        const pending = yield* Effect.forkChild(upload(tokenOf(prepared.relativeUrl), AUDIO_BODY));
        yield* Queue.take(harness.transcribing);
        yield* Fiber.interrupt(pending);

        yield* Queue.offer(harness.transcripts, Effect.succeed({ text: "fix the build" }));
        expect(yield* Queue.take(harness.dispatches)).toEqual({
          type: "message.dispatch",
          commandId: target.commandId,
          threadId: THREAD,
          messageId: target.messageId,
          createdBy: "user",
          creationSource: "web",
          text: "fix the build",
          attachments: [],
          dispatchMode: { type: "queue_after_active" },
        });
        expect((yield* Ref.get(harness.transcriptions))[0]?.context).toEqual({ threadId: THREAD });
        yield* Queue.offer(
          harness.dispatchReplies,
          Effect.succeed({ sequence: 7, storedEvents: [] }),
        );

        expect(yield* upload(tokenOf(prepared.relativeUrl), undefined)).toEqual({
          text: "fix the build",
          submission: { status: "sent", sequence: 7 },
        });
        expect(yield* Ref.get(harness.transcriptions)).toHaveLength(1);
      }).pipe(Effect.provide(harness.layer));
    }).pipe(Effect.provide(environment)),
  );

  it.effect("recovers a sent outcome after its provider can no longer transcribe", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      yield* Effect.gen(function* () {
        const target = submit("command-recover");
        const prepared = yield* prepare({ submit: target });
        const pending = yield* Effect.forkChild(upload(tokenOf(prepared.relativeUrl), AUDIO_BODY));
        yield* Queue.offer(harness.transcripts, Effect.succeed({ text: "ship it" }));
        yield* Queue.take(harness.dispatches);
        yield* Queue.offer(
          harness.dispatchReplies,
          Effect.succeed({ sequence: 9, storedEvents: [] }),
        );
        yield* Fiber.join(pending);

        yield* Ref.set(harness.sourceUsable, false);
        const again = yield* prepare({ submit: target });
        expect(yield* upload(tokenOf(again.relativeUrl), undefined)).toEqual({
          text: "ship it",
          submission: { status: "sent", sequence: 9 },
        });
        const refused = yield* Effect.flip(prepare({ submit: submit("command-new") }));
        expect(refused).toMatchObject({ reason: "signedOut" });
      }).pipe(Effect.provide(harness.layer));
    }).pipe(Effect.provide(environment)),
  );

  it.effect("joins a repeated upload or preparation instead of transcribing again", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      yield* Effect.gen(function* () {
        const first = yield* prepare({ submit: submit("command-2") });
        const again = yield* prepare({ submit: submit("command-2") });
        const pending = yield* Effect.forkChild(upload(tokenOf(first.relativeUrl), AUDIO_BODY));
        yield* Queue.take(harness.transcribing);
        // A client sending the audio again can't read the answer until its body is taken.
        const resentRead = yield* Deferred.make<void>();
        const resent = AUDIO_BODY.pipe(
          Stream.concat(Stream.fromEffectDrain(Deferred.succeed(resentRead, undefined))),
        );
        const repeated = yield* Effect.forkChild(upload(tokenOf(first.relativeUrl), resent));
        const reprepared = yield* Effect.forkChild(upload(tokenOf(again.relativeUrl), AUDIO_BODY));
        yield* Deferred.await(resentRead);

        yield* Queue.offer(harness.transcripts, Effect.succeed({ text: "ship it" }));
        yield* Queue.take(harness.dispatches);
        yield* Queue.offer(
          harness.dispatchReplies,
          Effect.succeed({ sequence: 3, storedEvents: [] }),
        );

        const expected = { text: "ship it", submission: { status: "sent", sequence: 3 } };
        expect(yield* Fiber.join(pending)).toEqual(expected);
        expect(yield* Fiber.join(repeated)).toEqual(expected);
        expect(yield* Fiber.join(reprepared)).toEqual(expected);
        expect(yield* Ref.get(harness.transcriptions)).toHaveLength(1);
        expect(yield* Queue.size(harness.dispatches)).toBe(0);
      }).pipe(Effect.provide(harness.layer));
    }).pipe(Effect.provide(environment)),
  );

  it.effect("refuses a different request that reuses the command", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      yield* Effect.gen(function* () {
        const first = yield* prepare({ submit: submit("command-3") });
        const other = yield* prepare({ language: "en", submit: submit("command-3") });
        yield* Effect.forkChild(upload(tokenOf(first.relativeUrl), AUDIO_BODY));
        yield* Queue.take(harness.transcribing);

        expect(yield* reason(upload(tokenOf(other.relativeUrl), AUDIO_BODY))).toBe(
          "requestConflict",
        );
        expect(yield* Ref.get(harness.transcriptions)).toHaveLength(1);
      }).pipe(Effect.provide(harness.layer));
    }).pipe(Effect.provide(environment)),
  );

  it.effect("stops sending when cancelled during transcription, but not once sending began", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      yield* Effect.gen(function* () {
        const stopped = yield* prepare({ submit: submit("command-4") });
        const pending = yield* Effect.forkChild(upload(tokenOf(stopped.relativeUrl), AUDIO_BODY));
        yield* Queue.take(harness.transcribing);

        expect(yield* cancel(stopped.uploadId)).toEqual({ outcome: "cancelled" });
        expect(yield* reason(Fiber.join(pending))).toBe("cancelled");
        expect(yield* reason(upload(tokenOf(stopped.relativeUrl), undefined))).toBe("cancelled");
        expect(yield* Queue.size(harness.dispatches)).toBe(0);
        expect(yield* leftoverFiles).toEqual([]);

        const sending = yield* prepare({ submit: submit("command-5") });
        const sent = yield* Effect.forkChild(upload(tokenOf(sending.relativeUrl), AUDIO_BODY));
        yield* Queue.take(harness.transcribing);
        yield* Queue.offer(harness.transcripts, Effect.succeed({ text: "keep going" }));
        yield* Queue.take(harness.dispatches);

        expect(yield* cancel(sending.uploadId)).toEqual({ outcome: "tooLate" });
        yield* Queue.offer(
          harness.dispatchReplies,
          Effect.succeed({ sequence: 9, storedEvents: [] }),
        );
        expect(yield* Fiber.join(sent)).toEqual({
          text: "keep going",
          submission: { status: "sent", sequence: 9 },
        });
      }).pipe(Effect.provide(harness.layer));
    }).pipe(Effect.provide(environment)),
  );

  it.effect("keeps a cancelled upload from starting when its body arrives late", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      yield* Effect.gen(function* () {
        const prepared = yield* prepare({});

        expect(yield* cancel(prepared.uploadId)).toEqual({ outcome: "cancelled" });
        expect(yield* reason(upload(tokenOf(prepared.relativeUrl), AUDIO_BODY))).toBe("cancelled");
        expect(yield* Ref.get(harness.transcriptions)).toEqual([]);
        expect(yield* leftoverFiles).toEqual([]);
      }).pipe(Effect.provide(harness.layer));
    }).pipe(Effect.provide(environment)),
  );

  it.effect("sends nothing without speech and keeps the transcript when sending fails", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      yield* Effect.gen(function* () {
        const silent = yield* prepare({ submit: submit("command-6") });
        const quiet = yield* Effect.forkChild(upload(tokenOf(silent.relativeUrl), AUDIO_BODY));
        yield* Queue.take(harness.transcribing);
        yield* Queue.offer(harness.transcripts, Effect.succeed({ text: "  " }));
        expect(yield* Fiber.join(quiet)).toEqual({
          text: "  ",
          submission: { status: "noSpeech" },
        });
        expect(yield* Queue.size(harness.dispatches)).toBe(0);

        const rejected = yield* prepare({ submit: submit("command-7") });
        const refused = yield* Effect.forkChild(upload(tokenOf(rejected.relativeUrl), AUDIO_BODY));
        yield* Queue.take(harness.transcribing);
        yield* Queue.offer(harness.transcripts, Effect.succeed({ text: "deploy" }));
        yield* Queue.take(harness.dispatches);
        yield* Queue.offer(
          harness.dispatchReplies,
          Effect.fail(
            new OrchestratorCommandRejectedError({
              commandId: CommandId.make("command-7"),
              commandType: "message.dispatch",
            }),
          ),
        );
        expect(yield* Fiber.join(refused)).toEqual({
          text: "deploy",
          submission: { status: "failed" },
        });
      }).pipe(Effect.provide(harness.layer));
    }).pipe(Effect.provide(environment)),
  );

  it.effect("leaves an interrupted body retryable and nothing on disk", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      yield* Effect.gen(function* () {
        const prepared = yield* prepare({});
        const nextChunkRequested = yield* Deferred.make<void>();
        const stalled = Stream.make(AUDIO.slice(0, 3)).pipe(
          Stream.concat(
            Stream.fromEffect(
              Deferred.succeed(nextChunkRequested, undefined).pipe(Effect.andThen(Effect.never)),
            ),
          ),
        );
        const partial = yield* Effect.forkChild(upload(tokenOf(prepared.relativeUrl), stalled));
        yield* Deferred.await(nextChunkRequested);
        yield* Fiber.interrupt(partial);
        expect(yield* leftoverFiles).toEqual([]);
        expect(
          yield* reason(upload(tokenOf(prepared.relativeUrl), Stream.make(AUDIO.slice(1)))),
        ).toBe("invalidAudio");
        expect(yield* Ref.get(harness.transcriptions)).toEqual([]);

        const retried = yield* Effect.forkChild(upload(tokenOf(prepared.relativeUrl), AUDIO_BODY));
        yield* Queue.take(harness.transcribing);
        yield* Queue.offer(harness.transcripts, Effect.succeed({ text: "again" }));
        expect(yield* Fiber.join(retried)).toEqual({ text: "again" });
      }).pipe(Effect.provide(harness.layer));
    }).pipe(Effect.provide(environment)),
  );

  it.effect("won't start work from a URL issued before a restart", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      const prepared = yield* prepare({}).pipe(Effect.provide(harness.layer));
      const restarted = yield* makeHarness;

      expect(
        yield* reason(upload(tokenOf(prepared.relativeUrl), AUDIO_BODY)).pipe(
          Effect.provide(restarted.layer),
        ),
      ).toBe("uploadExpired");
      expect(yield* Ref.get(restarted.transcriptions)).toEqual([]);
    }).pipe(Effect.provide(environment)),
  );

  it.effect("recovers an outcome after its URL expires but never starts work with it", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      yield* Effect.gen(function* () {
        const unused = yield* prepare({});
        const used = yield* prepare({});
        expect(yield* reason(upload(tokenOf(used.relativeUrl), undefined))).toBe("uploadExpired");
        yield* TestClock.adjust("5 minutes");
        const pending = yield* Effect.forkChild(upload(tokenOf(used.relativeUrl), AUDIO_BODY));
        yield* Queue.take(harness.transcribing);
        yield* Queue.offer(harness.transcripts, Effect.succeed({ text: "late" }));
        yield* Fiber.join(pending);
        yield* TestClock.adjust("6 minutes");

        expect(yield* upload(tokenOf(used.relativeUrl), undefined)).toEqual({ text: "late" });
        expect(yield* reason(upload(tokenOf(unused.relativeUrl), AUDIO_BODY))).toBe(
          "uploadExpired",
        );
        expect(yield* Ref.get(harness.transcriptions)).toHaveLength(1);
      }).pipe(Effect.provide(harness.layer));
    }).pipe(Effect.provide(environment)),
  );

  it.effect("keeps an outcome or cancellation for as long as a URL prepared again for it", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      yield* Effect.gen(function* () {
        const sent = yield* prepare({ submit: submit("command-8") });
        const pending = yield* Effect.forkChild(upload(tokenOf(sent.relativeUrl), AUDIO_BODY));
        yield* Queue.take(harness.transcribing);
        yield* Queue.offer(harness.transcripts, Effect.succeed({ text: "once" }));
        yield* Queue.take(harness.dispatches);
        yield* Queue.offer(
          harness.dispatchReplies,
          Effect.succeed({ sequence: 4, storedEvents: [] }),
        );
        yield* Fiber.join(pending);
        const stopped = yield* prepare({ submit: submit("command-9") });
        expect(yield* cancel(stopped.uploadId)).toEqual({ outcome: "cancelled" });

        yield* TestClock.adjust("9 minutes");
        const sentAgain = yield* prepare({ submit: submit("command-8") });
        const stoppedAgain = yield* prepare({ submit: submit("command-9") });
        yield* TestClock.adjust("2 minutes");

        expect(yield* upload(tokenOf(sentAgain.relativeUrl), AUDIO_BODY)).toEqual({
          text: "once",
          submission: { status: "sent", sequence: 4 },
        });
        expect(yield* reason(upload(tokenOf(stoppedAgain.relativeUrl), AUDIO_BODY))).toBe(
          "cancelled",
        );
        expect(yield* Ref.get(harness.transcriptions)).toHaveLength(1);
        expect(yield* Queue.size(harness.dispatches)).toBe(0);
      }).pipe(Effect.provide(harness.layer));
    }).pipe(Effect.provide(environment)),
  );

  it.effect("doesn't let cancellations use up upload capacity", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      yield* Effect.gen(function* () {
        yield* Effect.forEach(
          Array.from({ length: 65 }, (_, index) => `never-prepared-${index}`),
          (uploadId) => cancel(uploadId),
          { discard: true },
        );
        const prepared = yield* prepare({});
        yield* Queue.offer(harness.transcripts, Effect.succeed({ text: "room" }));
        expect(yield* upload(tokenOf(prepared.relativeUrl), AUDIO_BODY)).toEqual({ text: "room" });
      }).pipe(Effect.provide(harness.layer));
    }).pipe(Effect.provide(environment)),
  );
});

describe("TranscriptionUploads streamed dictations", () => {
  const live = <A, E, R>(
    body: (harness: Effect.Success<typeof makeHarness>) => Effect.Effect<A, E, R>,
  ) =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      return yield* body(harness).pipe(Effect.provide(harness.layer));
    }).pipe(Effect.provide(environment));

  it.effect("hands audio to the vendor while recording, then collects the transcript", () =>
    live((harness) =>
      Effect.gen(function* () {
        yield* Queue.offer(harness.livePlans, {
          _tag: "transcribe",
          result: Effect.succeed({ text: "ship it" }),
        });
        const client = yield* connect((yield* prepareStream("dictation-1")).relativeUrl);
        expect(yield* Queue.take(client.sent)).toBe('{"type":"ready","receivedBytes":0}');
        yield* client.send(frame(1));
        expect(yield* Queue.take(harness.liveAudio)).toEqual(frame(1));
        yield* client.send(frame(2));
        yield* client.finish;
        expect(yield* Queue.take(client.sent)).toBe('{"type":"finished"}');

        expect(yield* collect("dictation-1")).toEqual({ text: "ship it" });
        expect(yield* Ref.get(harness.transcriptions)).toEqual([]);
        expect(yield* Queue.take(client.sent)).toBe(1000);
      }),
    ),
  );

  it.effect(
    "sends a streamed voice message once, whether its transcript is in or still coming",
    () =>
      live((harness) =>
        Effect.gen(function* () {
          for (const transcriptFirst of [true, false]) {
            const uploadId = `voice-${transcriptFirst}`;
            const transcript = yield* Deferred.make<{ text: string }, TranscriptionError>();
            yield* Queue.offer(harness.livePlans, {
              _tag: "transcribe",
              result: Deferred.await(transcript),
            });
            const client = yield* connect((yield* prepareStream(uploadId)).relativeUrl);
            yield* Queue.take(client.sent);
            yield* client.send(frame(3));
            yield* client.finish;
            yield* Queue.take(client.sent);
            yield* Queue.take(harness.liveEnded);

            if (transcriptFirst) {
              yield* Deferred.succeed(transcript, { text: "run the tests" });
              expect(yield* collect(uploadId)).toEqual({ text: "run the tests" });
            }
            const send = yield* Effect.forkChild(
              collect(uploadId, undefined, { submit: submit(uploadId) }),
            );
            if (!transcriptFirst) yield* Deferred.succeed(transcript, { text: "run the tests" });
            expect(yield* Queue.take(harness.dispatches)).toMatchObject({
              commandId: uploadId,
              text: "run the tests",
            });
            yield* Queue.offer(
              harness.dispatchReplies,
              Effect.succeed({ sequence: 3, storedEvents: [] }),
            );
            const sent = { text: "run the tests", submission: { status: "sent", sequence: 3 } };
            expect(yield* Fiber.join(send)).toEqual(sent);
            expect(yield* collect(uploadId, undefined, { submit: submit(uploadId) })).toEqual(sent);
            const elsewhere = { ...submit(uploadId), messageId: MessageId.make("another-message") };
            expect(yield* reason(collect(uploadId, undefined, { submit: elsewhere }))).toBe(
              "requestConflict",
            );
          }
          expect(yield* Queue.size(harness.dispatches)).toBe(0);
          expect(yield* Ref.get(harness.transcriptions)).toEqual([]);
        }),
      ),
  );

  it.effect("resumes a reconnecting client from the audio it already took", () =>
    live((harness) =>
      Effect.gen(function* () {
        yield* Queue.offer(harness.livePlans, {
          _tag: "transcribe",
          result: Effect.succeed({ text: "resumed" }),
        });
        const prepared = yield* prepareStream("dictation-resume");
        const first = yield* connect(prepared.relativeUrl);
        yield* Queue.take(first.sent);
        yield* first.send(frame(4));
        yield* Queue.take(harness.liveAudio);
        yield* first.drop;
        yield* Fiber.join(first.fiber);

        const second = yield* connect(prepared.relativeUrl);
        expect(yield* Queue.take(second.sent)).toBe('{"type":"ready","receivedBytes":3200}');
        yield* second.send(frame(5));
        expect(yield* Queue.take(harness.liveAudio)).toEqual(frame(5));
        yield* second.finish;
        yield* Queue.take(second.sent);
        expect(yield* collect("dictation-resume")).toEqual({ text: "resumed" });
      }),
    ),
  );

  it.effect("fills in what a broken stream missed from the uploaded recording", () =>
    live((harness) =>
      Effect.gen(function* () {
        yield* Queue.offer(harness.livePlans, {
          _tag: "transcribe",
          result: Effect.succeed({ text: "whole clip" }),
        });
        const client = yield* connect((yield* prepareStream("dictation-gap")).relativeUrl);
        yield* Queue.take(client.sent);
        yield* client.send(frame(6));
        yield* Queue.take(harness.liveAudio);
        yield* client.drop;

        expect(yield* reason(collect("dictation-gap"))).toBe("uploadExpired");
        const recording = new Uint8Array([...frame(6), ...frame(7)]);
        expect(yield* collect("dictation-gap", wavOf(recording))).toEqual({ text: "whole clip" });
        expect(new Uint8Array(yield* Queue.take(harness.liveAudio))).toEqual(frame(7));
        expect(yield* Ref.get(harness.transcriptions)).toEqual([]);
      }),
    ),
  );

  it.effect("sends a refused stream back to the client, whose upload transcribes it fresh", () =>
    live((harness) =>
      Effect.gen(function* () {
        yield* Queue.offer(harness.livePlans, { _tag: "refuse" });
        const client = yield* connect((yield* prepareStream("dictation-refused")).relativeUrl);
        const sent = [yield* Queue.take(client.sent), yield* Queue.take(client.sent)];
        expect(sent).toContain(TRANSCRIPTION_STREAM_CLOSED_CODE);

        const recording = wavOf(frame(8));
        const pending = yield* Effect.forkChild(collect("dictation-refused", recording));
        yield* Queue.take(harness.transcribing);
        yield* Queue.offer(harness.transcripts, Effect.succeed({ text: "batch" }));
        expect(yield* Fiber.join(pending)).toEqual({ text: "batch" });
      }),
    ),
  );

  it.effect("fails a stream whose client never returns instead of transcribing it again", () =>
    live((harness) =>
      Effect.gen(function* () {
        yield* Queue.offer(harness.livePlans, {
          _tag: "transcribe",
          result: Effect.never,
        });
        const client = yield* connect((yield* prepareStream("dictation-lost")).relativeUrl);
        yield* Queue.take(client.sent);
        yield* client.send(frame(9));
        yield* Queue.take(harness.liveAudio);
        yield* client.drop;
        yield* Fiber.join(client.fiber);
        yield* TestClock.adjust("30 seconds");

        expect(yield* reason(collect("dictation-lost"))).toBe("failed");
        expect(yield* reason(collect("dictation-lost", wavOf(frame(9))))).toBe("failed");
        expect(yield* Ref.get(harness.transcriptions)).toEqual([]);
      }),
    ),
  );

  it.effect("ends and cancels the dictation when it is discarded or its session is revoked", () =>
    live((harness) =>
      Effect.gen(function* () {
        yield* Queue.offer(harness.livePlans, { _tag: "transcribe", result: Effect.never });
        const client = yield* connect((yield* prepareStream("dictation-cancel")).relativeUrl);
        yield* Queue.take(client.sent);
        expect(yield* cancel("dictation-cancel")).toEqual({ outcome: "cancelled" });
        expect(yield* Queue.take(client.sent)).toBe(1000);
        expect(yield* reason(collect("dictation-cancel", wavOf(frame(1))))).toBe("cancelled");

        yield* Queue.offer(harness.livePlans, { _tag: "transcribe", result: Effect.never });
        const revocation = yield* Deferred.make<void>();
        const revoked = yield* connect(
          (yield* prepareStream("dictation-revoked")).relativeUrl,
          Deferred.await(revocation),
        );
        yield* Queue.take(revoked.sent);
        yield* Deferred.succeed(revocation, undefined);
        expect(yield* Queue.take(revoked.sent)).toBe(1000);
        expect(yield* reason(collect("dictation-revoked"))).toBe("cancelled");
      }),
    ),
  );
});
