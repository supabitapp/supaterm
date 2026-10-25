import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  type OrchestrationV2Run,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as EventSink from "./EventSink.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";
import type * as ProviderAdapter from "@supaterm/provider-core/server/ProviderAdapter";

const driver = ProviderDriverKind.make("codex");
const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "test-model" };
const adapter: ProviderAdapter.ProviderAdapterV2["Service"] = {
  instanceId,
  driver,
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
  openSession: () => Effect.die("Side chat tests stop before provider execution"),
};
const layer = ProviderReplayHarness.layerWithRegistry(
  { name: "side-chat" },
  ProviderAdapterRegistry.layerFromAdapters([adapter]),
  { runEffectWorker: false },
);

const parentThreadId = ThreadId.make("side-chat-parent");

const createThread = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    yield* orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make(`create:${threadId}`),
      threadId,
      projectId: ProjectId.make("side-chat-project"),
      title: "Parent",
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdBy: "user",
      creationSource: "web",
    });
  });

const writeRun = (threadId: ThreadId, ordinal: number, status: OrchestrationV2Run["status"]) =>
  Effect.gen(function* () {
    const eventSink = yield* EventSink.EventSinkV2;
    const now = yield* DateTime.now;
    const runId = RunId.make(`${threadId}:run:${ordinal}`);
    yield* eventSink.write({
      events: [
        {
          id: EventId.make(`${runId}:${status}`),
          type: "run.created",
          threadId,
          runId,
          occurredAt: now,
          payload: {
            id: runId,
            threadId,
            ordinal,
            providerInstanceId: instanceId,
            modelSelection,
            providerThreadId: null,
            userMessageId: MessageId.make(`${runId}:message`),
            rootNodeId: null,
            activeAttemptId: null,
            status,
            requestedAt: now,
            startedAt: now,
            completedAt: status === "running" ? null : now,
            checkpointId: null,
            contextHandoffId: null,
          },
        },
      ],
    });
    return runId;
  });

const openSideChat = (
  targetThreadId: ThreadId,
  sourceThreadId = parentThreadId,
  sourcePoint: { readonly type: "live" } | { readonly type: "latest_stable" } = { type: "live" },
) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    return yield* orchestrator.dispatch({
      type: "thread.fork",
      commandId: CommandId.make(`fork:${targetThreadId}`),
      sourceThreadId,
      targetThreadId,
      sourcePoint,
      sideChat: true,
      runtimeMode: "approval-required",
      createdBy: "user",
      creationSource: "web",
    });
  });

const mergeBack = (sourceThreadId: ThreadId, runId: RunId, attempt: string) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    return yield* orchestrator.dispatch({
      type: "thread.merge_back",
      commandId: CommandId.make(`merge:${sourceThreadId}:${attempt}`),
      sourceThreadId,
      targetThreadId: parentThreadId,
      sourcePoint: { type: "run", runId },
      createdBy: "user",
      creationSource: "web",
    });
  });

it.effect("opens a hidden, supervised side chat and promotes it to a normal thread", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const sideChatId = ThreadId.make("side-chat-promoted");
    yield* createThread(parentThreadId);
    yield* writeRun(parentThreadId, 1, "completed");

    yield* openSideChat(sideChatId, parentThreadId, { type: "latest_stable" });
    const sideChat = yield* orchestrator.getThreadShell(sideChatId);
    assert.isTrue(sideChat?.sideChat);
    assert.equal(sideChat?.runtimeMode, "approval-required");
    assert.equal(sideChat?.lineage.relationshipToParent, "fork");

    yield* orchestrator.dispatch({
      type: "thread.metadata.update",
      commandId: CommandId.make("promote-side-chat"),
      threadId: sideChatId,
      sideChat: false,
    });
    const promoted = yield* orchestrator.getThreadProjection(sideChatId);
    assert.isUndefined((yield* orchestrator.getThreadShell(sideChatId))?.sideChat);
    assert.isFalse(promoted.thread.sideChat);
    assert.isDefined(promoted.thread.sideChatPromotedAt);
  }).pipe(Effect.provide(layer)),
);

it.effect("refuses a side chat opened from another side chat", () =>
  Effect.gen(function* () {
    yield* createThread(parentThreadId);
    yield* writeRun(parentThreadId, 1, "completed");
    const sideChatId = ThreadId.make("side-chat-outer");
    yield* openSideChat(sideChatId);
    yield* writeRun(sideChatId, 1, "completed");

    const error = yield* openSideChat(ThreadId.make("side-chat-nested"), sideChatId).pipe(
      Effect.flip,
    );
    assert.equal(error._tag, "OrchestratorDispatchError");
  }).pipe(Effect.provide(layer)),
);

it.effect("snapshots a running parent live, and its finished run otherwise", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    yield* createThread(parentThreadId);
    yield* writeRun(parentThreadId, 1, "completed");
    const runningRunId = yield* writeRun(parentThreadId, 2, "running");

    const liveId = ThreadId.make("side-chat-live");
    yield* openSideChat(liveId);
    const [liveTransfer] = (yield* orchestrator.getThreadProjection(liveId)).contextTransfers;
    assert.equal(liveTransfer?.snapshot, "live");
    assert.equal(liveTransfer?.sourcePoint.runId, runningRunId);

    const stableId = ThreadId.make("side-chat-stable");
    yield* openSideChat(stableId, parentThreadId, { type: "latest_stable" });
    const [stableTransfer] = (yield* orchestrator.getThreadProjection(stableId)).contextTransfers;
    assert.isUndefined(stableTransfer?.snapshot);
    assert.equal(stableTransfer?.sourcePoint.runId, RunId.make(`${parentThreadId}:run:1`));
  }).pipe(Effect.provide(layer)),
);

it.effect("refuses a live side chat before the parent has anything to fork", () =>
  Effect.gen(function* () {
    yield* createThread(parentThreadId);
    const error = yield* openSideChat(ThreadId.make("side-chat-too-early")).pipe(Effect.flip);
    assert.equal(error._tag, "OrchestratorDispatchError");
  }).pipe(Effect.provide(layer)),
);

it.effect("merges back only into an idle parent, one fork at a time", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    yield* createThread(parentThreadId);
    yield* writeRun(parentThreadId, 1, "completed");
    const firstId = ThreadId.make("side-chat-first");
    const secondId = ThreadId.make("side-chat-second");
    yield* openSideChat(firstId);
    yield* openSideChat(secondId);
    const firstRun = yield* writeRun(firstId, 1, "completed");
    const secondRun = yield* writeRun(secondId, 1, "completed");

    yield* writeRun(parentThreadId, 2, "running");
    const busy = yield* mergeBack(firstId, firstRun, "busy").pipe(Effect.flip);
    assert.equal(busy._tag, "OrchestratorDispatchError");
    assert.include(String(busy.cause), "idle");

    yield* writeRun(parentThreadId, 2, "completed");
    yield* mergeBack(firstId, firstRun, "idle");
    yield* mergeBack(firstId, firstRun, "again");
    const second = yield* mergeBack(secondId, secondRun, "second").pipe(Effect.flip);
    assert.equal(second._tag, "OrchestratorDispatchError");
    assert.include(String(second.cause), "already has a merge-back");

    const pending = (yield* orchestrator.getThreadProjection(
      parentThreadId,
    )).contextTransfers.filter(
      (transfer) => transfer.type === "merge_back" && transfer.status === "pending",
    );
    assert.deepEqual(
      pending.map((transfer) => transfer.sourceThreadId),
      [firstId],
    );
  }).pipe(Effect.provide(layer)),
);
