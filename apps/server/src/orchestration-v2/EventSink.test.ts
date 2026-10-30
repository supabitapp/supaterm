import { assert, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  NodeId,
  RunId,
  CheckpointId,
  type OrchestrationV2Run,
  EventId,
  type ModelSelection,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as EventSink from "./EventSink.ts";
import * as EventStore from "./EventStore.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as TurnItemPositionStore from "./TurnItemPositionStore.ts";
import * as CommandReceiptStore from "./CommandReceiptStore.ts";
import * as EffectOutbox from "./EffectOutbox.ts";
const layerDatabase = SqlitePersistence.layerMemory;
const layerStoresProvided = Layer.mergeAll(
  EventStore.layer.pipe(Layer.provideMerge(layerDatabase)),
  ProjectionStore.layer.pipe(Layer.provideMerge(layerDatabase)),
);
const layerEffectOutboxProvided = EffectOutbox.layer.pipe(Layer.provide(layerDatabase));
const layerCommandReceiptStoreProvided = CommandReceiptStore.layer.pipe(
  Layer.provide(layerDatabase),
);
const providerInstanceId = ProviderInstanceId.make("codex");
const modelSelection = {
  instanceId: providerInstanceId,
  model: "gpt-5.4",
} satisfies ModelSelection;

function makeThread(threadId: ThreadId, now: DateTime.Utc): OrchestrationV2AppThread {
  return {
    createdBy: "user",
    creationSource: "web",
    id: threadId,
    projectId: ProjectId.make(`project:${threadId}`),
    title: `Thread ${threadId}`,
    providerInstanceId,
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: {
      parentThreadId: null,
      relationshipToParent: null,
      rootThreadId: threadId,
    },
    forkedFrom: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    doneOverride: null,
    doneAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  };
}

function threadCreatedEvent(input: {
  readonly id: string;
  readonly thread: OrchestrationV2AppThread;
  readonly now: DateTime.Utc;
}): OrchestrationV2DomainEvent {
  return {
    id: EventId.make(input.id),
    type: "thread.created",
    threadId: input.thread.id,
    providerInstanceId,
    occurredAt: input.now,
    payload: input.thread,
  };
}

it.effect.each(["cancel transaction", "fail transaction", "cancel publication"] as const)(
  "preserves event consistency and allows later writes after %s",
  (scenario) =>
    Effect.gen(function* () {
      const paused = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const committed = scenario === "cancel publication";
      const pause = Deferred.succeed(paused, undefined).pipe(
        Effect.andThen(Deferred.await(release)),
      );
      const layerPausingOutbox = Layer.effect(
        EffectOutbox.EffectOutboxV2,
        Effect.gen(function* () {
          const delegate = yield* EffectOutbox.EffectOutboxV2;
          return EffectOutbox.EffectOutboxV2.of({
            ...delegate,
            enqueue: (effects) =>
              delegate
                .enqueue(effects)
                .pipe(
                  Effect.andThen(!committed && effects.length > 0 ? pause : Effect.void),
                  Effect.andThen(
                    scenario === "fail transaction" && effects.length > 0
                      ? Effect.die("Injected transaction failure")
                      : Effect.void,
                  ),
                ),
            notifyAvailable: (count) =>
              (committed ? pause : Effect.void).pipe(
                Effect.andThen(delegate.notifyAvailable(count)),
              ),
          });
        }),
      ).pipe(Layer.provide(layerEffectOutboxProvided));
      const layerEventSink = EventSink.layerFromStores.pipe(
        Layer.provide(
          Layer.mergeAll(
            layerStoresProvided,
            layerPausingOutbox,
            layerCommandReceiptStoreProvided,
            ProjectStore.layer.pipe(Layer.provide(layerDatabase)),
            TurnItemPositionStore.layer.pipe(Layer.provide(layerDatabase)),
          ),
        ),
      );

      yield* Effect.gen(function* () {
        const eventSink = yield* EventSink.EventSinkV2;
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        const outbox = yield* EffectOutbox.EffectOutboxV2;
        const now = yield* DateTime.now;
        const first = makeThread(ThreadId.make("thread:interrupted-publish:first"), now);
        const marker = makeThread(ThreadId.make("thread:interrupted-publish:marker"), now);
        const published = yield* eventSink
          .stream({ afterSequence: yield* eventSink.latestSequence() })
          .pipe(
            Stream.takeUntil((stored) => stored.event.threadId === marker.id),
            Stream.runCollect,
            Effect.forkScoped({ startImmediately: true }),
          );
        const writer = yield* eventSink
          .writeWithEffects({
            events: [
              threadCreatedEvent({ id: "event:interrupted-publish:first", thread: first, now }),
            ],
            effects: [
              {
                id: "effect:interrupted-publish:first",
                commandId: CommandId.make("command:interrupted-publish:first"),
                threadId: first.id,
                request: { type: "terminal.cleanup" },
              },
            ],
          })
          .pipe(Effect.forkScoped);
        yield* Deferred.await(paused);
        if (scenario !== "fail transaction") writer.interruptUnsafe();
        if (scenario !== "cancel transaction") yield* Deferred.succeed(release, undefined);
        assert.equal((yield* Fiber.await(writer))._tag, "Failure");
        assert.equal(
          (yield* projections.getThreadShell(first.id))?.id ?? null,
          committed ? first.id : null,
        );
        assert.equal(
          Option.isSome(yield* outbox.get("effect:interrupted-publish:first")),
          committed,
        );
        yield* eventSink.write({
          events: [
            threadCreatedEvent({ id: "event:interrupted-publish:marker", thread: marker, now }),
          ],
        });
        assert.deepEqual(
          Array.from(yield* Fiber.join(published), (stored) => stored.event.threadId),
          committed ? [first.id, marker.id] : [marker.id],
        );
      }).pipe(
        Effect.provide(
          Layer.mergeAll(layerEventSink, layerStoresProvided, layerEffectOutboxProvided),
        ),
      );
    }).pipe(Effect.provide(layerDatabase)),
);

const layerCommittedSink = Layer.mergeAll(
  layerStoresProvided,
  EventSink.layer.pipe(Layer.provide(layerStoresProvided)),
  layerEffectOutboxProvided,
);

it.effect("commits effect-only commands exactly once at the current thread sequence", () =>
  Effect.gen(function* () {
    const sink = yield* EventSink.EventSinkV2;
    const outbox = yield* EffectOutbox.EffectOutboxV2;
    const now = yield* DateTime.now;
    const thread = makeThread(ThreadId.make("thread:effect-only"), now);
    yield* sink.write({ events: [threadCreatedEvent({ id: "event:effect-only", thread, now })] });
    const sequence = yield* sink.latestSequence({ threadId: thread.id });
    const commandId = CommandId.make("command:effect-only");
    const input = {
      commandId,
      threadId: thread.id,
      commandType: "thread.stop",
      acceptedAt: now,
      events: [],
      effects: [
        {
          id: "effect:effect-only",
          commandId,
          threadId: thread.id,
          request: { type: "terminal.cleanup" as const },
        },
      ],
    };
    const first = yield* sink.commitCommand(input);
    const repeated = yield* sink.commitCommand(input);
    assert.isTrue(first.committed);
    assert.isFalse(repeated.committed);
    assert.equal(first.receipt.resultSequence, sequence);
    assert.equal(yield* sink.latestSequence({ threadId: thread.id }), sequence);
    assert.isTrue(Option.isSome(yield* outbox.get("effect:effect-only")));
  }).pipe(Effect.provide(layerCommittedSink)),
);

it.effect("merges a stale delegated acknowledgement into the committed parent run", () =>
  Effect.gen(function* () {
    const sink = yield* EventSink.EventSinkV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const now = yield* DateTime.now;
    const thread = makeThread(ThreadId.make("thread:acknowledge"), now);
    const run: OrchestrationV2Run = {
      id: RunId.make("run:acknowledge"),
      threadId: thread.id,
      ordinal: 1,
      providerInstanceId,
      modelSelection,
      providerThreadId: null,
      userMessageId: MessageId.make("message:acknowledge"),
      rootNodeId: NodeId.make("node:acknowledge"),
      activeAttemptId: null,
      status: "failed",
      requestedAt: now,
      startedAt: now,
      completedAt: now,
      checkpointId: CheckpointId.make("checkpoint:acknowledge"),
      contextHandoffId: null,
      delegatedCompletion: { disposition: "open", nextGeneration: 1, delivery: null },
    };
    yield* sink.write({
      events: [
        threadCreatedEvent({ id: "event:acknowledge:thread", thread, now }),
        {
          id: EventId.make("event:acknowledge:run"),
          type: "run.created",
          threadId: thread.id,
          runId: run.id,
          occurredAt: now,
          payload: run,
        },
      ],
    });
    yield* sink.commitCommand({
      commandId: CommandId.make("command:acknowledge"),
      threadId: thread.id,
      commandType: "delegated-completion.dispose",
      acceptedAt: now,
      effects: [],
      updateDelegatedCompletionOnlyRunId: run.id,
      events: [
        {
          id: EventId.make("event:acknowledge:dispose"),
          type: "run.updated",
          threadId: thread.id,
          runId: run.id,
          occurredAt: now,
          payload: {
            ...run,
            status: "running",
            completedAt: null,
            checkpointId: null,
            delegatedCompletion: { disposition: "disposed", nextGeneration: 2, delivery: null },
          },
        },
      ],
    });
    const current = (yield* projections.getThreadRecords(thread.id, ["runs"], { runIds: [run.id] }))
      .runs[0]!;
    assert.equal(current.status, "failed");
    assert.equal(current.checkpointId, run.checkpointId);
    assert.deepEqual(current.completedAt, now);
    assert.equal(current.delegatedCompletion?.disposition, "disposed");
  }).pipe(Effect.provide(layerCommittedSink)),
);
