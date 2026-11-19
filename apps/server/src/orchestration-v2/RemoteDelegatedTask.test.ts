import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  EventId,
  MessageId,
  NodeId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  RunId,
  ThreadId,
} from "@supaterm/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as EventSink from "./EventSink.ts";
import * as Orchestrator from "./Orchestrator.ts";
import type * as ProviderAdapter from "@supaterm/provider-core/server/ProviderAdapter";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderContinuationRequests from "@supaterm/provider-core/server/ProviderContinuationRequests";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";

// A delegated task whose child runs in a linked environment is recorded on
// its parent without a child thread here, and completing it wakes the parent
// the way a local child's result does.

const instanceId = ProviderInstanceId.make("codex");
const driver = ProviderDriverKind.make("codex");
const modelSelection = { instanceId, model: "gpt-5.4" };
const adapter = {
  instanceId,
  driver,
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("No provider process needed for delegated task records"),
} as ProviderAdapter.ProviderAdapterV2["Service"];

/** Every parent wake the orchestrator offers, for the tests to read. */
class Offers extends Context.Service<
  Offers,
  Ref.Ref<ReadonlyArray<ProviderContinuationRequests.ProviderContinuationRequest>>
>()("supaterm/orchestration-v2/RemoteDelegatedTask.test/Offers") {}
const layerOffers = Layer.effect(
  Offers,
  Ref.make<ReadonlyArray<ProviderContinuationRequests.ProviderContinuationRequest>>([]),
);
const layerDatabase = SqlitePersistence.layerMemory;
const layerTest = Layer.mergeAll(
  layerDatabase,
  ProjectionStore.layer.pipe(Layer.provide(layerDatabase)),
  ProviderReplayHarness.layerWithRegistry(
    { name: "remote-delegated-task" },
    ProviderAdapterRegistry.layerFromAdapters([adapter]),
    { databaseLayer: layerDatabase, runEffectWorker: false },
  ),
).pipe(
  Layer.provide(
    Layer.effect(
      ProviderContinuationRequests.ProviderContinuationRequests,
      Offers.pipe(
        Effect.map((offers) => ({
          offer: (request: ProviderContinuationRequests.ProviderContinuationRequest) =>
            Ref.update(offers, (seen) => [...seen, request]),
          take: Effect.never,
        })),
      ),
    ),
  ),
  Layer.provideMerge(layerOffers),
);

/** A parent thread whose run is live, as when its agent calls delegate_task. */
const seedLiveParent = (name: string) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const sink = yield* EventSink.EventSinkV2;
    const now = yield* DateTime.now;
    const threadId = ThreadId.make(`thread:${name}`);
    const runId = RunId.make(`run:${name}`);
    const rootNodeId = NodeId.make(`node:${name}:root`);
    const providerThreadId = ProviderThreadId.make(`provider-thread:${name}`);
    yield* orchestrator.dispatch({
      type: "thread.create",
      createdBy: "user",
      creationSource: "web",
      commandId: CommandId.make(`command:create:${name}`),
      threadId,
      projectId: ProjectId.make("project:remote-delegated-task"),
      title: "Parent",
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
    });
    yield* sink.write({
      commandId: CommandId.make(`command:seed:${name}`),
      events: [
        {
          id: EventId.make(`event:seed-provider-thread:${name}`),
          type: "provider-thread.updated",
          threadId,
          driver,
          providerInstanceId: instanceId,
          occurredAt: now,
          payload: {
            id: providerThreadId,
            driver,
            providerInstanceId: instanceId,
            providerSessionId: null,
            appThreadId: threadId,
            ownerNodeId: rootNodeId,
            nativeThreadRef: { driver, nativeId: `native:${name}`, strength: "strong" },
            nativeConversationHeadRef: null,
            status: "active",
            firstRunOrdinal: 1,
            lastRunOrdinal: 1,
            handoffIds: [],
            forkedFrom: null,
            createdAt: now,
            updatedAt: now,
          },
        },
        {
          id: EventId.make(`event:seed-node:${name}`),
          type: "node.updated",
          threadId,
          runId,
          nodeId: rootNodeId,
          driver,
          providerInstanceId: instanceId,
          occurredAt: now,
          payload: {
            id: rootNodeId,
            threadId,
            runId,
            parentNodeId: null,
            rootNodeId,
            kind: "root_turn",
            status: "running",
            countsForRun: true,
            providerThreadId,
            providerTurnId: null,
            nativeItemRef: null,
            runtimeRequestId: null,
            checkpointScopeId: null,
            startedAt: now,
            completedAt: null,
          },
        },
        {
          id: EventId.make(`event:seed-run:${name}`),
          type: "run.updated",
          threadId,
          runId,
          nodeId: rootNodeId,
          providerInstanceId: instanceId,
          occurredAt: now,
          payload: {
            id: runId,
            threadId,
            ordinal: 1,
            providerInstanceId: instanceId,
            modelSelection,
            providerThreadId,
            userMessageId: MessageId.make(`message:seed-user:${name}`),
            rootNodeId,
            activeAttemptId: null,
            status: "running",
            requestedAt: now,
            startedAt: now,
            completedAt: null,
            checkpointId: null,
            contextHandoffId: null,
          },
        },
      ],
    });
    return { threadId, runId, rootNodeId };
  });

const remoteChild = {
  environmentId: EnvironmentId.make("environment:box"),
  threadId: ThreadId.make("thread:on-the-box"),
  label: "Box",
};

it.layer(layerTest)("a delegated task in a linked environment", (it) => {
  it.effect("is recorded on its parent without a child thread here, once", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const parent = yield* seedLiveParent("records");
      const request = {
        type: "delegated_task.remote.request" as const,
        commandId: CommandId.make("command:remote-delegate:records"),
        parentThreadId: parent.threadId,
        parentRunId: parent.runId,
        parentNodeId: parent.rootNodeId,
        task: "Run the suite there.",
        driver: ProviderDriverKind.make("remote"),
        modelSelection,
        remote: { remoteChild },
        completionWake: "always" as const,
      };
      yield* orchestrator.dispatch(request);
      yield* orchestrator.dispatch(request);
      const projection = yield* orchestrator.getThreadProjection(parent.threadId);
      assert.equal(projection.subagents.length, 1);
      const [task] = projection.subagents;
      assert.equal(task?.childThreadId, null);
      assert.deepEqual(task?.remoteChild, remoteChild);
      assert.deepEqual(task?.modelSelection, modelSelection);
      assert.equal(task?.status, "running");
      const item = projection.turnItems.find((candidate) => candidate.type === "subagent");
      assert.deepEqual(item?.type === "subagent" ? item.remoteChild : undefined, remoteChild);
      // No thread was created here for the child.
      assert.equal(yield* orchestrator.getThreadShell(remoteChild.threadId), null);
      const other = yield* seedLiveParent("records-no-task");
      const index = yield* (yield* ProjectionStore.ProjectionStoreV2).listActiveShellIndex();
      assert.isTrue(index.find((entry) => entry.id === parent.threadId)?.hasRemoteTasks);
      assert.isFalse(index.find((entry) => entry.id === other.threadId)?.hasRemoteTasks);
      // Nothing here can cancel the task there, so it must not block archiving.
      yield* orchestrator.dispatch({
        type: "thread.archive",
        commandId: CommandId.make("command:archive:records"),
        threadId: parent.threadId,
      });
      assert.isNotNull((yield* orchestrator.getThreadShell(parent.threadId))?.archivedAt);
    }),
  );

  it.effect("keeps a newer stop recoverable after an older acknowledgement", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const parent = yield* seedLiveParent("stop-generation");
      yield* orchestrator.dispatch({
        type: "delegated_task.remote.request",
        commandId: CommandId.make("command:remote-delegate:stop-generation"),
        parentThreadId: parent.threadId,
        parentRunId: parent.runId,
        parentNodeId: parent.rootNodeId,
        task: "Run a check.",
        driver: ProviderDriverKind.make("remote"),
        modelSelection,
        remote: { remoteChild },
      });
      const task = (yield* orchestrator.getThreadProjection(parent.threadId)).subagents[0]!;
      const openFor = projections.getOpenRemoteDelegatedTasks.pipe(
        Effect.map((open) => open.filter((entry) => entry.parentThreadId === parent.threadId)),
      );
      const complete = {
        type: "delegated_task.remote.complete" as const,
        parentThreadId: parent.threadId,
        taskId: task.id,
        status: "completed" as const,
        result: "Original result.",
      };
      yield* orchestrator.dispatch({
        ...complete,
        commandId: CommandId.make("command:result:stop-generation"),
        stoppedThere: "ran-out",
      });
      for (const count of [1, 2]) {
        yield* orchestrator.dispatch({
          type: "delegated_task.remote.stop",
          parentThreadId: parent.threadId,
          taskId: task.id,
          commandId: CommandId.make(`command:stop-generation:${count}`),
        });
      }
      // Reports from before generation tracking cannot clear a later numbered Stop either.
      for (const stopCount of [undefined, 1]) {
        const rejected = yield* orchestrator
          .dispatch({
            ...complete,
            commandId: CommandId.make(`command:stale-stop:${stopCount}`),
            stoppedThere: "stopped",
            ...(stopCount === undefined ? {} : { stopCount }),
          })
          .pipe(Effect.flip);
        assert.equal(rejected._tag, "OrchestratorDispatchError");
        assert.deepEqual(yield* openFor, [{ parentThreadId: parent.threadId, taskId: task.id }]);
      }
      yield* orchestrator.dispatch({
        ...complete,
        commandId: CommandId.make("command:current-stop:2"),
        stoppedThere: "stopped",
        stopCount: 2,
      });
      const settled = (yield* orchestrator.getThreadProjection(parent.threadId)).subagents[0]!;
      assert.equal(settled.result, "Original result.");
      assert.equal(settled.status, "completed");
      assert.equal(settled.remoteChild?.stoppedThere, true);
      assert.deepEqual(yield* openFor, []);
    }),
  );

  it.effect("owes a stop there for a Stop here that loses the race to its result", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const parent = yield* seedLiveParent("stop-after-result");
      yield* orchestrator.dispatch({
        type: "delegated_task.remote.request",
        commandId: CommandId.make("command:remote-delegate:stop-after-result"),
        parentThreadId: parent.threadId,
        parentRunId: parent.runId,
        parentNodeId: parent.rootNodeId,
        task: "Run a check.",
        driver: ProviderDriverKind.make("remote"),
        modelSelection,
        remote: { remoteChild },
      });
      const task = (yield* orchestrator.getThreadProjection(parent.threadId)).subagents[0]!;
      const complete = {
        type: "delegated_task.remote.complete" as const,
        parentThreadId: parent.threadId,
        taskId: task.id,
      };
      yield* orchestrator.dispatch({
        ...complete,
        commandId: CommandId.make("command:result:stop-after-result"),
        status: "completed",
        result: "Done there.",
        stoppedThere: "ran-out",
      });
      // The parent's Stop read the task before its result landed.
      yield* orchestrator.dispatch({
        ...complete,
        commandId: CommandId.make("command:parent-stop:stop-after-result"),
        status: "interrupted",
        result: "Stopped with its parent.",
      });

      const stopped = (yield* orchestrator.getThreadProjection(parent.threadId)).subagents[0]!;
      assert.equal(stopped.status, "completed");
      assert.equal(stopped.result, "Done there.");
      assert.equal(stopped.remoteChild?.stoppedThere, false);
      assert.equal(stopped.remoteChild?.stopCount, 1);
      const open = yield* projections.getOpenRemoteDelegatedTasks;
      assert.deepEqual(
        open.filter((entry) => entry.parentThreadId === parent.threadId),
        [{ parentThreadId: parent.threadId, taskId: task.id }],
      );
    }),
  );

  it.effect("wakes its parent with the result when it completes there", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const parent = yield* seedLiveParent("completes");
      const recorded = yield* orchestrator.dispatch({
        type: "delegated_task.remote.request",
        commandId: CommandId.make("command:remote-delegate:completes"),
        parentThreadId: parent.threadId,
        parentRunId: parent.runId,
        parentNodeId: parent.rootNodeId,
        task: "Run the suite there.",
        driver: ProviderDriverKind.make("remote"),
        modelSelection,
        remote: { remoteChild },
        completionWake: "always",
      });
      const taskEvent = recorded.storedEvents.find(
        (stored) => stored.event.type === "subagent.updated",
      );
      const taskId =
        taskEvent?.event.type === "subagent.updated" ? taskEvent.event.payload.id : undefined;
      assert.isDefined(taskId);
      // Until it completes, it is open, and a restarted follower picks it up.
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const openFor = projections.getOpenRemoteDelegatedTasks.pipe(
        Effect.map((open) => open.filter((task) => task.parentThreadId === parent.threadId)),
      );
      assert.deepEqual(yield* openFor, [{ parentThreadId: parent.threadId, taskId: taskId! }]);
      const offers = yield* Offers;
      yield* Ref.set(offers, []);
      const complete = (result: string) =>
        orchestrator.dispatch({
          type: "delegated_task.remote.complete",
          commandId: CommandId.make(`command:remote-complete:${result}`),
          parentThreadId: parent.threadId,
          taskId: taskId!,
          status: "completed",
          result,
          stoppedThere: "ran-out",
        });
      yield* complete("All 412 tests pass on the box.");
      // A second report is refused, so the first result stands.
      const late = yield* complete("A late, different answer.").pipe(Effect.flip);
      assert.equal(late._tag, "OrchestratorDispatchError");

      const projection = yield* orchestrator.getThreadProjection(parent.threadId);
      const task = projection.subagents.find((candidate) => candidate.id === taskId);
      assert.equal(task?.status, "completed");
      assert.equal(task?.result, "All 412 tests pass on the box.");
      // The live parent run claimed it, so task_status acknowledges it as for a local child.
      assert.equal(task?.completionDelivery?.state, "claimed");
      // Nothing is left for the follower to pick up after a restart.
      assert.deepEqual(yield* openFor, []);
      const item = projection.turnItems.find(
        (candidate) => candidate.type === "subagent" && candidate.subagentId === taskId,
      );
      assert.equal(item?.status, "completed");
      // The parent's live run is offered the delivery, as for a local child.
      const delivery = projection.runs.find((run) => run.id === parent.runId)?.delegatedCompletion
        ?.delivery;
      assert.deepEqual(delivery?.taskIds, [taskId]);
      const offered = yield* Ref.get(offers);
      assert.equal(offered.length, 1);
      assert.equal(offered[0]?.threadId, parent.threadId);
    }),
  );
  const launchOf = (name: string, completionWake: "always" | "settled_only") => ({
    environmentId: remoteChild.environmentId,
    label: "Box",
    linkedAt: "2026-11-01T00:00:00.000Z",
    requestNamespace: `provider-session:${name}`,
    key: `key:${name}`,
    projectId: ProjectId.make("project:on-the-box"),
    title: "Run the suite there.",
    completionWake,
  });

  const recordLaunch = (name: string, completionWake: "always" | "settled_only" = "always") =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const parent = yield* seedLiveParent(name);
      yield* orchestrator.dispatch({
        type: "delegated_task.remote.request",
        commandId: CommandId.make(`command:remote-delegate:${name}`),
        parentThreadId: parent.threadId,
        parentRunId: parent.runId,
        parentNodeId: parent.rootNodeId,
        task: "Run the suite there.",
        driver: ProviderDriverKind.make("remote"),
        modelSelection,
        remote: { remoteLaunch: launchOf(name, completionWake) },
      });
      const taskOf = orchestrator
        .getThreadProjection(parent.threadId)
        .pipe(Effect.map((projection) => projection.subagents[0]!));
      return { orchestrator, parent, taskOf, taskId: (yield* taskOf).id };
    });

  it.effect("is recorded before its launch is answered, then names the thread it started", () =>
    Effect.gen(function* () {
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const { orchestrator, parent, taskOf, taskId } = yield* recordLaunch("launch-attach");
      const launching = yield* taskOf;
      assert.isUndefined(launching.remoteChild);
      assert.equal(launching.remoteLaunch?.key, "key:launch-attach");
      // Its caller hears a refusal from the call itself, so the launch takes no wake yet.
      assert.equal(launching.completionWake, "settled_only");
      const openFor = projections.getOpenRemoteDelegatedTasks.pipe(
        Effect.map((open) => open.filter((entry) => entry.parentThreadId === parent.threadId)),
      );
      assert.deepEqual(yield* openFor, [{ parentThreadId: parent.threadId, taskId }]);
      const index = yield* projections.listActiveShellIndex();
      assert.isTrue(index.find((entry) => entry.id === parent.threadId)?.hasRemoteTasks);

      const attach = {
        type: "delegated_task.remote.attach" as const,
        commandId: CommandId.make("command:remote-task-attach:launch-attach"),
        parentThreadId: parent.threadId,
        taskId,
        remoteChild,
        modelSelection: { ...modelSelection, model: "the-model-there" },
      };
      yield* orchestrator.dispatch(attach);
      const attached = yield* taskOf;
      assert.deepEqual(attached.remoteChild, remoteChild);
      assert.equal(attached.model, "the-model-there");
      assert.equal(attached.completionWake, "always");
      assert.equal(attached.status, "running");
      const projection = yield* orchestrator.getThreadProjection(parent.threadId);
      const item = projection.turnItems.find((candidate) => candidate.type === "subagent");
      assert.deepEqual(item?.type === "subagent" ? item.remoteChild : undefined, remoteChild);
      // A launch sent twice names its thread once; another thread for it is refused.
      yield* orchestrator
        .dispatch({ ...attach, commandId: CommandId.make("command:attach-again") })
        .pipe(Effect.ignore);
      const other = yield* orchestrator
        .dispatch({
          ...attach,
          commandId: CommandId.make("command:attach-other"),
          remoteChild: { ...remoteChild, threadId: ThreadId.make("thread:a-second-one") },
        })
        .pipe(Effect.flip);
      assert.equal(other._tag, "OrchestratorDispatchError");
      assert.deepEqual((yield* taskOf).remoteChild, remoteChild);
      assert.deepEqual(yield* openFor, [{ parentThreadId: parent.threadId, taskId }]);
    }),
  );

  it.effect(
    "ended here before its launch is answered keeps the launch until a thread is named",
    () =>
      Effect.gen(function* () {
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        const { orchestrator, parent, taskOf, taskId } = yield* recordLaunch("launch-cancelled");
        yield* orchestrator.dispatch({
          type: "delegated_task.remote.complete",
          commandId: CommandId.make("command:remote-task-complete:launch-cancelled"),
          parentThreadId: parent.threadId,
          taskId,
          status: "cancelled",
          result: "Cancelled.",
        });
        const cancelled = yield* taskOf;
        assert.equal(cancelled.status, "cancelled");
        assert.isUndefined(cancelled.remoteChild);
        const openFor = projections.getOpenRemoteDelegatedTasks.pipe(
          Effect.map((open) => open.filter((entry) => entry.parentThreadId === parent.threadId)),
        );
        // Still open: the launch may have started a thread there that is yet to stop.
        assert.deepEqual(yield* openFor, [{ parentThreadId: parent.threadId, taskId }]);
        yield* orchestrator.dispatch({
          type: "delegated_task.remote.attach",
          commandId: CommandId.make("command:remote-task-attach:launch-cancelled"),
          parentThreadId: parent.threadId,
          taskId,
          remoteChild,
          modelSelection,
        });
        const attached = yield* taskOf;
        assert.equal(attached.status, "cancelled");
        assert.equal(attached.result, "Cancelled.");
        assert.deepEqual(attached.remoteChild, remoteChild);
        // Now it owes that thread a stop, as any task cancelled here does.
        assert.deepEqual(yield* openFor, [{ parentThreadId: parent.threadId, taskId }]);
      }),
  );

  it.effect("whose launch started nothing there ends with nothing left to follow", () =>
    Effect.gen(function* () {
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const { orchestrator, parent, taskOf, taskId } = yield* recordLaunch("launch-refused");
      yield* orchestrator.dispatch({
        type: "delegated_task.remote.complete",
        commandId: CommandId.make("command:remote-task-abandon:launch-refused"),
        parentThreadId: parent.threadId,
        taskId,
        status: "failed",
        result: "No project there has this repository.",
        launchAbandoned: true,
      });
      const refused = yield* taskOf;
      assert.equal(refused.status, "failed");
      assert.equal(refused.result, "No project there has this repository.");
      assert.isTrue(refused.remoteLaunch?.abandoned);
      const open = yield* projections.getOpenRemoteDelegatedTasks;
      assert.deepEqual(
        open.filter((entry) => entry.parentThreadId === parent.threadId),
        [],
      );
      // Nothing runs there for it, so it keeps its parent in no trimmed list.
      const index = yield* projections.listActiveShellIndex();
      assert.isFalse(index.find((entry) => entry.id === parent.threadId)?.hasRemoteTasks);
      const attach = yield* orchestrator
        .dispatch({
          type: "delegated_task.remote.attach",
          commandId: CommandId.make("command:remote-task-attach:launch-refused"),
          parentThreadId: parent.threadId,
          taskId,
          remoteChild,
          modelSelection,
        })
        .pipe(Effect.flip);
      assert.equal(attach._tag, "OrchestratorDispatchError");
    }),
  );

  it.effect("answered after a timed-out wait keeps the wake that wait asked for", () =>
    Effect.gen(function* () {
      const { orchestrator, parent, taskOf, taskId } = yield* recordLaunch(
        "launch-waited",
        "settled_only",
      );
      yield* orchestrator.dispatch({
        type: "delegated_task.wake-policy",
        commandId: CommandId.make("command:wake-policy:launch-waited"),
        parentThreadId: parent.threadId,
        taskId,
        completionWake: "always",
      });
      yield* orchestrator.dispatch({
        type: "delegated_task.remote.attach",
        commandId: CommandId.make("command:remote-task-attach:launch-waited"),
        parentThreadId: parent.threadId,
        taskId,
        remoteChild,
        modelSelection,
      });
      assert.equal((yield* taskOf).completionWake, "always");
    }),
  );

  it.effect("answered after its parent was marked Done owes that Done to its thread there", () =>
    Effect.gen(function* () {
      const sink = yield* EventSink.EventSinkV2;
      const { orchestrator, parent, taskOf, taskId } = yield* recordLaunch("launch-done");
      const now = yield* DateTime.now;
      const run = (yield* orchestrator.getThreadProjection(parent.threadId)).runs[0]!;
      yield* sink.write({
        commandId: CommandId.make("command:seed:launch-done:run-ended"),
        events: [
          {
            id: EventId.make("event:seed-run-ended:launch-done"),
            type: "run.updated",
            threadId: parent.threadId,
            runId: parent.runId,
            nodeId: parent.rootNodeId,
            providerInstanceId: instanceId,
            occurredAt: now,
            payload: { ...run, status: "completed", completedAt: now },
          },
        ],
      });
      yield* orchestrator.dispatch({
        type: "thread.mark-done",
        commandId: CommandId.make("command:mark-done:launch-done"),
        threadId: parent.threadId,
      });
      yield* orchestrator.dispatch({
        type: "delegated_task.remote.attach",
        commandId: CommandId.make("command:remote-task-attach:launch-done"),
        parentThreadId: parent.threadId,
        taskId,
        remoteChild,
        modelSelection,
      });
      assert.equal((yield* taskOf).remoteChild?.doneOwed, "mark_done");
    }),
  );

  it.effect("owes its parent's Mark Done and Reopen to each thread there once, newest last", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const sink = yield* EventSink.EventSinkV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const parent = yield* seedLiveParent("done-owed");
      const elsewhere = { ...remoteChild, threadId: ThreadId.make("thread:also-on-the-box") };
      // A follow-up shares its task's thread there; a third task has a thread of its own.
      for (const [name, there] of [
        ["first", remoteChild],
        ["follow-up", remoteChild],
        ["other", elsewhere],
      ] as const) {
        yield* orchestrator.dispatch({
          type: "delegated_task.remote.request",
          commandId: CommandId.make(`command:remote-delegate:done-owed:${name}`),
          parentThreadId: parent.threadId,
          parentRunId: parent.runId,
          parentNodeId: parent.rootNodeId,
          task: "Run a check.",
          driver: ProviderDriverKind.make("remote"),
          modelSelection,
          remote: { remoteChild: there },
        });
      }
      const tasks = (yield* projections.getRemoteDelegatedTasks(parent.threadId)).map(
        (task) => task.id,
      );
      for (const taskId of tasks) {
        yield* orchestrator.dispatch({
          type: "delegated_task.remote.complete",
          commandId: CommandId.make(`command:result:done-owed:${taskId}`),
          parentThreadId: parent.threadId,
          taskId,
          status: "completed",
          result: "All green.",
          stoppedThere: "ran-out",
        });
      }
      const now = yield* DateTime.now;
      const run = (yield* orchestrator.getThreadProjection(parent.threadId)).runs[0]!;
      yield* sink.write({
        commandId: CommandId.make("command:seed:done-owed:run-ended"),
        events: [
          {
            id: EventId.make("event:seed-run-ended:done-owed"),
            type: "run.updated",
            threadId: parent.threadId,
            runId: parent.runId,
            nodeId: parent.rootNodeId,
            providerInstanceId: instanceId,
            occurredAt: now,
            payload: { ...run, status: "completed", completedAt: now },
          },
        ],
      });
      const owed = projections
        .getRemoteDelegatedTasks(parent.threadId)
        .pipe(Effect.map((all) => all.map((task) => task.remoteChild?.doneOwed)));
      const openFor = projections.getOpenRemoteDelegatedTasks.pipe(
        Effect.map((open) =>
          open.flatMap((entry) => (entry.parentThreadId === parent.threadId ? [entry.taskId] : [])),
        ),
      );
      assert.deepEqual(yield* openFor, []);

      yield* orchestrator.dispatch({
        type: "thread.mark-done",
        commandId: CommandId.make("command:mark-done:done-owed"),
        threadId: parent.threadId,
      });
      assert.deepEqual(yield* owed, [undefined, "mark_done", "mark_done"]);
      assert.sameMembers(yield* openFor, [tasks[1]!, tasks[2]!]);

      yield* orchestrator.dispatch({
        type: "thread.reopen",
        commandId: CommandId.make("command:reopen:done-owed"),
        threadId: parent.threadId,
        reason: "user",
      });
      assert.deepEqual(yield* owed, [undefined, "reopen", "reopen"]);
      const passOn = (taskId: NodeId, passedOn: "mark_done" | "reopen") =>
        orchestrator.dispatch({
          type: "delegated_task.remote.done",
          commandId: CommandId.make(`command:done-owed:${taskId}:${passedOn}`),
          parentThreadId: parent.threadId,
          taskId,
          passedOn,
        });
      // The Done sent before the Reopen answers late and leaves the Reopen owed.
      const stale = yield* passOn(tasks[1]!, "mark_done").pipe(Effect.flip);
      assert.equal(stale._tag, "OrchestratorDispatchError");
      assert.deepEqual(yield* owed, [undefined, "reopen", "reopen"]);
      yield* passOn(tasks[1]!, "reopen");
      yield* passOn(tasks[2]!, "reopen");
      assert.deepEqual(yield* owed, [undefined, undefined, undefined]);
      assert.deepEqual(yield* openFor, []);

      // Reopening a thread that was not Done owes nothing there.
      yield* orchestrator.dispatch({
        type: "thread.reopen",
        commandId: CommandId.make("command:reopen-again:done-owed"),
        threadId: parent.threadId,
        reason: "user",
      });
      assert.deepEqual(yield* owed, [undefined, undefined, undefined]);
    }),
  );
});
