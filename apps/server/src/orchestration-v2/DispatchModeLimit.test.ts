import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@supaterm/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import { DispatchModeLimit } from "./DispatchModeLimit.ts";
import * as EventSink from "./EventSink.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";
import type * as ProviderAdapter from "@supaterm/provider-core/server/ProviderAdapter";

const instanceId = ProviderInstanceId.make("codex");
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("No provider process needed for metadata commands"),
} as ProviderAdapter.ProviderAdapterV2["Service"];
const layerDatabase = SqlitePersistence.layerMemory;
const layerTest = Layer.mergeAll(
  layerDatabase,
  ProjectionStore.layer.pipe(Layer.provide(layerDatabase)),
  ProviderReplayHarness.layerWithRegistry(
    { name: "dispatch-mode-limit" },
    ProviderAdapterRegistry.layerFromAdapters([adapter]),
    { databaseLayer: layerDatabase, runEffectWorker: false },
  ),
);

const supervised = { runtimeMode: "approval-required", interactionMode: "default" } as const;

const createThread = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    yield* orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make(`create:${threadId}`),
      threadId,
      projectId: ProjectId.make("project:dispatch-mode-limit"),
      title: "Before",
      modelSelection: { instanceId, model: "gpt-5" },
      ...supervised,
      branch: null,
      worktreePath: null,
      createdBy: "user",
      creationSource: "web",
    });
  });

it.layer(layerTest)("DispatchModeLimit", (it) => {
  it.effect("refuses a limited command on a thread its user raised, and records nothing", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const threadId = ThreadId.make("thread:limit-raised");
      yield* createThread(threadId);
      yield* orchestrator.dispatch({
        type: "thread.runtime-mode.set",
        commandId: CommandId.make("raise"),
        threadId,
        runtimeMode: "full-access",
      });
      const rename = {
        type: "thread.metadata.update",
        commandId: CommandId.make("rename"),
        threadId,
        title: "After",
      } as const;
      const refused = yield* orchestrator
        .dispatch(rename)
        .pipe(Effect.provideService(DispatchModeLimit, supervised), Effect.flip);
      assert.equal(refused._tag, "OrchestratorThreadAboveModeLimitError");
      assert.equal((yield* projections.getThreadShell(threadId))?.title, "Before");

      yield* orchestrator.dispatch({
        type: "thread.runtime-mode.set",
        commandId: CommandId.make("lower"),
        threadId,
        runtimeMode: "approval-required",
      });
      yield* orchestrator
        .dispatch(rename)
        .pipe(Effect.provideService(DispatchModeLimit, supervised));
      assert.equal((yield* projections.getThreadShell(threadId))?.title, "After");
    }),
  );

  it.effect("refuses to fork a source thread its user raised", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const sourceThreadId = ThreadId.make("thread:limit-fork-source");
      const targetThreadId = ThreadId.make("thread:limit-fork-target");
      yield* createThread(sourceThreadId);
      yield* orchestrator.dispatch({
        type: "thread.runtime-mode.set",
        commandId: CommandId.make("raise-source"),
        threadId: sourceThreadId,
        runtimeMode: "full-access",
      });
      const fork = {
        type: "thread.fork",
        commandId: CommandId.make("fork"),
        sourceThreadId,
        targetThreadId,
        sourcePoint: { type: "latest_stable" },
        createdBy: "agent",
        creationSource: "mcp",
      } as const;
      const refused = yield* orchestrator
        .dispatch(fork)
        .pipe(Effect.provideService(DispatchModeLimit, supervised), Effect.flip);
      assert.ok(refused._tag === "OrchestratorThreadAboveModeLimitError");
      assert.equal(refused.threadId, sourceThreadId);
      assert.isNull(yield* projections.getThreadShell(targetThreadId));

      yield* orchestrator.dispatch({
        type: "thread.runtime-mode.set",
        commandId: CommandId.make("lower-source"),
        threadId: sourceThreadId,
        runtimeMode: "approval-required",
      });
      const retried = yield* orchestrator
        .dispatch(fork)
        .pipe(Effect.provideService(DispatchModeLimit, supervised), Effect.flip);
      assert.equal(retried._tag, "OrchestratorDispatchError");
    }),
  );
});

const layerPolicyDatabase = SqlitePersistence.layerMemory;
const layerWithCeiling = Layer.mergeAll(
  layerPolicyDatabase,
  ProjectionStore.layer.pipe(Layer.provide(layerPolicyDatabase)),
  ProviderReplayHarness.layerWithRegistry(
    { name: "runtime-mode-ceiling" },
    ProviderAdapterRegistry.layerFromAdapters([adapter]),
    {
      databaseLayer: layerPolicyDatabase,
      runEffectWorker: false,
      managedPolicy: {
        schemaVersion: 1,
        organization: "Example Corp",
        limits: { maxRuntimeMode: "auto-accept-edits" },
      },
    },
  ),
);

const sendMessage = (threadId: ThreadId, id: string) => ({
  type: "message.dispatch" as const,
  commandId: CommandId.make(`send:${id}`),
  threadId,
  messageId: MessageId.make(`message:${id}`),
  text: id,
  attachments: [],
  dispatchMode: { type: "start_immediately" as const },
  createdBy: "user" as const,
  creationSource: "web" as const,
});

/** A thread that ran in full access before the policy arrived, as an import or an older build leaves it. */
const raiseBehindPolicy = (threadId: ThreadId) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const sink = yield* EventSink.EventSinkV2;
    yield* createThread(threadId);
    const { thread } = yield* orchestrator.getThreadRecords(threadId, []);
    yield* sink.write({
      events: [
        {
          id: EventId.make(`event:raise-behind-policy:${threadId}`),
          type: "thread.runtime-mode-updated",
          threadId,
          occurredAt: yield* DateTime.now,
          payload: { ...thread, runtimeMode: "full-access" },
        },
      ],
    });
  });

it.layer(layerWithCeiling)("runtime mode ceiling", (it) => {
  it.effect("refuses the user's own thread and mode changes above the ceiling", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const threadId = ThreadId.make("thread:ceiling-user");
      const create = {
        type: "thread.create",
        commandId: CommandId.make("create:ceiling-user:full"),
        threadId,
        projectId: ProjectId.make("project:dispatch-mode-limit"),
        title: "Full",
        modelSelection: { instanceId, model: "gpt-5" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdBy: "user",
        creationSource: "web",
      } as const;
      const refusedCreate = yield* orchestrator.dispatch(create).pipe(Effect.flip);
      assert.ok(refusedCreate._tag === "OrchestratorRuntimeModeAboveCeilingError");
      assert.equal(refusedCreate.refused, "mode");
      assert.equal(refusedCreate.message, "Example Corp limits threads to Auto-accept edits.");
      assert.isNull(yield* projections.getThreadShell(threadId));

      yield* createThread(threadId);
      const raise = yield* orchestrator
        .dispatch({
          type: "thread.runtime-mode.set",
          commandId: CommandId.make("raise:ceiling-user"),
          threadId,
          runtimeMode: "auto",
        })
        .pipe(Effect.flip);
      assert.equal(raise._tag, "OrchestratorRuntimeModeAboveCeilingError");
      yield* orchestrator.dispatch({
        type: "thread.runtime-mode.set",
        commandId: CommandId.make("raise-to-ceiling:ceiling-user"),
        threadId,
        runtimeMode: "auto-accept-edits",
      });
      assert.equal((yield* projections.getThreadShell(threadId))?.runtimeMode, "auto-accept-edits");
    }),
  );

  it.effect("narrows an MCP caller's limit to the ceiling inside the lock", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const threadId = ThreadId.make("thread:ceiling-mcp");
      yield* createThread(threadId);
      const fullAccessCaller = { runtimeMode: "full-access", interactionMode: "default" } as const;
      const raise = yield* orchestrator
        .dispatch({
          type: "thread.runtime-mode.set",
          commandId: CommandId.make("raise:ceiling-mcp"),
          threadId,
          runtimeMode: "full-access",
        })
        .pipe(Effect.provideService(DispatchModeLimit, fullAccessCaller), Effect.flip);
      assert.equal(raise._tag, "OrchestratorRuntimeModeAboveCeilingError");

      const raisedThreadId = ThreadId.make("thread:ceiling-mcp-raised");
      yield* raiseBehindPolicy(raisedThreadId);
      const rename = yield* orchestrator
        .dispatch({
          type: "thread.metadata.update",
          commandId: CommandId.make("rename:ceiling-mcp"),
          threadId: raisedThreadId,
          title: "After",
        })
        .pipe(Effect.provideService(DispatchModeLimit, fullAccessCaller), Effect.flip);
      assert.equal(rename._tag, "OrchestratorThreadAboveModeLimitError");
      assert.equal((yield* projections.getThreadShell(raisedThreadId))?.title, "Before");

      // supaterm_thread_configure changes the model the same way, so it is held to the ceiling too.
      const configure = (threadId: ThreadId, id: string) =>
        orchestrator
          .dispatch({
            type: "thread.model-selection.set",
            commandId: CommandId.make(`configure:${id}`),
            threadId,
            modelSelection: { instanceId, model: "gpt-5-mini" },
          })
          .pipe(Effect.provideService(DispatchModeLimit, fullAccessCaller));
      const configured = yield* configure(raisedThreadId, "raised").pipe(Effect.flip);
      assert.equal(configured._tag, "OrchestratorThreadAboveModeLimitError");
      yield* configure(threadId, "under");
      assert.equal(
        (yield* projections.getThreadShell(threadId))?.modelSelection.model,
        "gpt-5-mini",
      );
    }),
  );

  it.effect("refuses turns on a thread above the ceiling until its mode is lowered", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const threadId = ThreadId.make("thread:ceiling-raised");
      yield* raiseBehindPolicy(threadId);

      const refused = yield* orchestrator
        .dispatch(sendMessage(threadId, "first"))
        .pipe(Effect.flip);
      assert.ok(refused._tag === "OrchestratorRuntimeModeAboveCeilingError");
      assert.equal(refused.refused, "turn");
      assert.equal(
        refused.message,
        "Example Corp limits threads to Auto-accept edits. Switch this thread's mode to continue.",
      );
      assert.lengthOf((yield* orchestrator.getThreadRecords(threadId, ["runs"])).runs, 0);

      // The user's own housekeeping and the way back down stay open.
      yield* orchestrator.dispatch({
        type: "thread.metadata.update",
        commandId: CommandId.make("rename:ceiling-raised"),
        threadId,
        title: "After",
      });
      yield* orchestrator.dispatch({
        type: "thread.runtime-mode.set",
        commandId: CommandId.make("lower:ceiling-raised"),
        threadId,
        runtimeMode: "approval-required",
      });
      // Refusals record no receipt, so the same command goes through once the mode is lowered.
      yield* orchestrator.dispatch(sendMessage(threadId, "first"));
      assert.lengthOf((yield* orchestrator.getThreadRecords(threadId, ["runs"])).runs, 1);
      assert.equal((yield* projections.getThreadShell(threadId))?.title, "After");
    }),
  );

  it.effect("refuses a side chat that would inherit its parent's mode above the ceiling", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const parentThreadId = ThreadId.make("thread:ceiling-side-chat-parent");
      const sideChatThreadId = ThreadId.make("thread:ceiling-side-chat");
      yield* raiseBehindPolicy(parentThreadId);
      const openSideChat = {
        type: "thread.fork",
        commandId: CommandId.make("side-chat:ceiling"),
        sourceThreadId: parentThreadId,
        targetThreadId: sideChatThreadId,
        sourcePoint: { type: "latest_stable" },
        sideChat: true,
        createdBy: "user",
        creationSource: "web",
      } as const;

      const refused = yield* orchestrator.dispatch(openSideChat).pipe(Effect.flip);
      assert.ok(refused._tag === "OrchestratorRuntimeModeAboveCeilingError");
      assert.equal(refused.threadId, sideChatThreadId);
      assert.equal(refused.runtimeMode, "full-access");
      assert.isNull(yield* projections.getThreadShell(sideChatThreadId));

      yield* orchestrator.dispatch({
        type: "thread.runtime-mode.set",
        commandId: CommandId.make("lower:ceiling-side-chat-parent"),
        threadId: parentThreadId,
        runtimeMode: "auto-accept-edits",
      });
      yield* orchestrator.dispatch(openSideChat);
      assert.equal(
        (yield* projections.getThreadShell(sideChatThreadId))?.runtimeMode,
        "auto-accept-edits",
      );
    }),
  );

  it.effect("refuses a delegated task above the ceiling and accepts one at it", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const parentThreadId = ThreadId.make("thread:ceiling-delegate-parent");
      yield* createThread(parentThreadId);
      yield* orchestrator.dispatch(sendMessage(parentThreadId, "delegate-parent"));
      const [parentRun] = (yield* orchestrator.getThreadRecords(parentThreadId, ["runs"])).runs;
      const delegate = (id: string, runtimeMode: "full-access" | "auto-accept-edits") =>
        orchestrator.dispatch({
          type: "delegated_task.request",
          commandId: CommandId.make(`delegate:${id}`),
          parentThreadId,
          parentRunId: parentRun!.id,
          parentNodeId: parentRun!.rootNodeId!,
          task: "Review the change",
          modelSelection: { instanceId, model: "gpt-5" },
          runtimeMode,
          interactionMode: "default",
          createdBy: "agent",
          creationSource: "mcp",
        });

      const refused = yield* delegate("above", "full-access").pipe(Effect.flip);
      assert.ok(refused._tag === "OrchestratorRuntimeModeAboveCeilingError");
      assert.equal(refused.runtimeMode, "full-access");
      assert.isNull(yield* projections.getThreadShell(refused.threadId));

      const accepted = yield* delegate("at", "auto-accept-edits");
      const child = accepted.storedEvents.find(({ event }) => event.type === "thread.created");
      assert.ok(child?.event.type === "thread.created");
      assert.equal(child.event.payload.runtimeMode, "auto-accept-edits");
    }),
  );

  it.effect("starts a queue that waited above the ceiling once the mode is lowered", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const sink = yield* EventSink.EventSinkV2;
      const threadId = ThreadId.make("thread:ceiling-queue");
      yield* createThread(threadId);
      yield* orchestrator.dispatch(sendMessage(threadId, "running"));
      yield* orchestrator.dispatch({
        ...sendMessage(threadId, "waiting"),
        dispatchMode: { type: "queue_after_active" },
      });
      // The policy arrives with the thread above it and its first run ending.
      const { thread, runs } = yield* orchestrator.getThreadRecords(threadId, ["runs"]);
      const [running, waiting] = runs;
      const occurredAt = yield* DateTime.now;
      yield* sink.write({
        events: [
          {
            id: EventId.make("event:ceiling-queue:raise"),
            type: "thread.runtime-mode-updated",
            threadId,
            occurredAt,
            payload: { ...thread, runtimeMode: "full-access" },
          },
          {
            id: EventId.make("event:ceiling-queue:complete"),
            type: "run.updated",
            threadId,
            runId: running!.id,
            providerInstanceId: running!.providerInstanceId,
            occurredAt,
            payload: { ...running!, status: "completed" },
          },
        ],
      });

      yield* orchestrator.dispatch({
        type: "thread.runtime-mode.set",
        commandId: CommandId.make("lower:ceiling-queue"),
        threadId,
        runtimeMode: "approval-required",
      });
      const started = (yield* orchestrator.getThreadRecords(threadId, ["runs"])).runs.find(
        (run) => run.id === waiting!.id,
      );
      assert.notEqual(started?.status, "queued");
    }),
  );
});
