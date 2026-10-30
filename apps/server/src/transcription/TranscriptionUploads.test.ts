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
  TranscriptionError,
  type TranscriptionPrepareUploadInput,
} from "@supaterm/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
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

const submit = (commandId: string) => ({
  threadId: THREAD,
  commandId: CommandId.make(commandId),
  messageId: MessageId.make(`message-${commandId}`),
});

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
  const layer = TranscriptionUploads.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(Transcription.Transcription)({
          transcribeFile: (input) =>
            Ref.update(transcriptions, (current) => [...current, input]).pipe(
              Effect.andThen(Queue.offer(transcribing, NodeFS.readFileSync(input.path, "hex"))),
              Effect.andThen(Queue.take(transcripts)),
              Effect.flatten,
            ),
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
  return { transcriptions, transcribing, transcripts, dispatches, dispatchReplies, layer };
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
  body: Stream.Stream<Uint8Array> | undefined = Stream.make(AUDIO),
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
        const pending = yield* Effect.forkChild(upload(tokenOf(prepared.relativeUrl)));
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
        const pending = yield* Effect.forkChild(upload(tokenOf(prepared.relativeUrl)));
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

  it.effect("joins a repeated upload or preparation instead of transcribing again", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      yield* Effect.gen(function* () {
        const first = yield* prepare({ submit: submit("command-2") });
        const again = yield* prepare({ submit: submit("command-2") });
        const pending = yield* Effect.forkChild(upload(tokenOf(first.relativeUrl)));
        yield* Queue.take(harness.transcribing);
        const repeated = yield* Effect.forkChild(upload(tokenOf(first.relativeUrl)));
        const reprepared = yield* Effect.forkChild(upload(tokenOf(again.relativeUrl)));

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
        yield* Effect.forkChild(upload(tokenOf(first.relativeUrl)));
        yield* Queue.take(harness.transcribing);

        expect(yield* reason(upload(tokenOf(other.relativeUrl)))).toBe("requestConflict");
        expect(yield* Ref.get(harness.transcriptions)).toHaveLength(1);
      }).pipe(Effect.provide(harness.layer));
    }).pipe(Effect.provide(environment)),
  );

  it.effect("stops sending when cancelled during transcription, but not once sending began", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      yield* Effect.gen(function* () {
        const stopped = yield* prepare({ submit: submit("command-4") });
        const pending = yield* Effect.forkChild(upload(tokenOf(stopped.relativeUrl)));
        yield* Queue.take(harness.transcribing);

        expect(yield* cancel(stopped.uploadId)).toEqual({ outcome: "cancelled" });
        expect(yield* reason(Fiber.join(pending))).toBe("cancelled");
        expect(yield* reason(upload(tokenOf(stopped.relativeUrl), undefined))).toBe("cancelled");
        expect(yield* Queue.size(harness.dispatches)).toBe(0);
        expect(yield* leftoverFiles).toEqual([]);

        const sending = yield* prepare({ submit: submit("command-5") });
        const sent = yield* Effect.forkChild(upload(tokenOf(sending.relativeUrl)));
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
        expect(yield* reason(upload(tokenOf(prepared.relativeUrl)))).toBe("cancelled");
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
        const quiet = yield* Effect.forkChild(upload(tokenOf(silent.relativeUrl)));
        yield* Queue.take(harness.transcribing);
        yield* Queue.offer(harness.transcripts, Effect.succeed({ text: "  " }));
        expect(yield* Fiber.join(quiet)).toEqual({
          text: "  ",
          submission: { status: "noSpeech" },
        });
        expect(yield* Queue.size(harness.dispatches)).toBe(0);

        const rejected = yield* prepare({ submit: submit("command-7") });
        const refused = yield* Effect.forkChild(upload(tokenOf(rejected.relativeUrl)));
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

        const retried = yield* Effect.forkChild(upload(tokenOf(prepared.relativeUrl)));
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
        yield* reason(upload(tokenOf(prepared.relativeUrl))).pipe(Effect.provide(restarted.layer)),
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
        yield* TestClock.adjust("5 minutes");
        const pending = yield* Effect.forkChild(upload(tokenOf(used.relativeUrl)));
        yield* Queue.take(harness.transcribing);
        yield* Queue.offer(harness.transcripts, Effect.succeed({ text: "late" }));
        yield* Fiber.join(pending);
        yield* TestClock.adjust("6 minutes");

        expect(yield* upload(tokenOf(used.relativeUrl), undefined)).toEqual({ text: "late" });
        expect(yield* reason(upload(tokenOf(unused.relativeUrl)))).toBe("uploadExpired");
        expect(yield* Ref.get(harness.transcriptions)).toHaveLength(1);
      }).pipe(Effect.provide(harness.layer));
    }).pipe(Effect.provide(environment)),
  );
});
